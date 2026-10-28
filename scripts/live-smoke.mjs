// Owner-run live verification. Creates two guest identities and a private test room.
// No service-role key, database password, or mocked multiplayer state is used.
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { MovieConnectionEngine } from '../src/movies/engine.ts';
import { ConnectionEngine } from '../src/engine.ts';
import { FootballConnectionEngine } from '../src/football/engine.ts';
import { PREVIEW_CONFIGURATION, validatePublicConfiguration } from '../src/configuration.ts';

const pause = ms => new Promise(done => setTimeout(done, ms));
const safeMessage = value => String(value ?? '')
  .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted JWT]')
  .replace(/sb_(?:secret|publishable)_[A-Za-z0-9_-]+/g, '[redacted key]');

/** SUBSCRIBED must mean Postgres readiness, not only a joined WebSocket channel. */
export function watchMatchUpdates(client, roomId, player, readyTimeoutMs = 15000) {
  const events = [];
  const diagnostics = { player, status: 'CONNECTING', databaseReady: false, system: [] };
  let settled = false;
  let resolveReady, rejectReady;
  const ready = new Promise((done, fail) => { resolveReady = done; rejectReady = fail; });
  const fail = message => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    rejectReady(new Error(safeMessage(message)));
  };
  const timer = setTimeout(() => fail('Player ' + player + ': database subscription readiness timed out.'), readyTimeoutMs);
  const channel = client.channel('smoke:' + player + ':' + roomId, {
    config: { postgres_changes_options: { wait: true, timeout: 10000 } },
  })
    .on('postgres_changes', {
      event: 'UPDATE', schema: 'public', table: 'matches', filter: 'room_id=eq.' + roomId,
    }, payload => {
      const row = payload.new ?? {};
      events.push({ id: row.id, revision: row.revision, status: row.status });
    })
    .on('system', {}, payload => {
      diagnostics.system.push({
        extension: safeMessage(payload.extension), status: safeMessage(payload.status),
        message: safeMessage(payload.message),
      });
      if (diagnostics.system.length > 8) diagnostics.system.shift();
      if (payload.status === 'error') fail('Player ' + player + ': ' + payload.message);
    })
    .subscribe((status, error) => {
      diagnostics.status = status;
      if (status === 'SUBSCRIBED' && !settled) {
        settled = true;
        clearTimeout(timer);
        diagnostics.databaseReady = true;
        resolveReady();
      } else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) {
        fail('Player ' + player + ': ' + status + (error ? ' — ' + error.message : ''));
      }
    });
  return {
    ready, events, diagnostics,
    async stop() {
      fail('Player ' + player + ': subscription stopped before it was ready.');
      clearTimeout(timer);
      await client.removeChannel(channel);
    },
  };
}

/** Only an actual active-match UPDATE for the accepted revision can pass. */
export async function requireMoveDelivery(streams, match, timeoutMs = 5000) {
  const until = Date.now() + timeoutMs;
  const observed = stream => stream.events.some(event =>
    event.id === match.id && event.revision === match.revision && event.status === 'active');
  while (!streams.every(observed)) {
    if (Date.now() >= until) {
      const error = new Error('Both independent clients must receive the accepted move through Realtime.');
      error.diagnostics = {
        expectedRevision: match.revision,
        clients: streams.map(stream => ({
          ...stream.diagnostics, matchingMoveReceived: observed(stream),
          receivedUpdates: stream.events.length, revisions: stream.events.map(event => event.revision),
        })),
      };
      throw error;
    }
    await pause(Math.min(50, Math.max(1, until - Date.now())));
  }
}

/** Observe Cron through SELECT only; never invoke a command that can expire the match. */
export async function requireIndependentTimeout(readMatch, match, clock, {
  graceMs = 5000, pollMs = 250, now = () => performance.now(), wait = pause,
} = {}) {
  const serverTime = Date.parse(clock.serverTime);
  const deadline = Date.parse(match.deadline);
  assert.ok(Number.isFinite(serverTime) && Number.isFinite(deadline), 'Timeout verification requires valid server timestamps.');
  assert.ok(Number.isFinite(clock.receivedAt) && Number.isFinite(clock.requestStartedAt), 'Timeout verification requires a monotonic clock sample.');
  assert.ok(clock.receivedAt >= clock.requestStartedAt);
  assert.equal(match.status, 'active', 'The match must still be active before the independent timeout check.');
  const winnerId = match.room.players.find(player => player.id !== match.activePlayer)?.id;
  assert.ok(winnerId, 'The timeout winner must be the other participant.');

  // The server sample was made before the response arrived. Anchoring it at
  // receipt conservatively waits until the deadline, independent of PC time.
  const dueAt = clock.receivedAt + deadline - serverTime;
  const stopAt = dueAt + graceMs;
  let reads = 0, last, observedAt;
  const diagnostics = () => ({
    matchId: match.id, serverDeadline: match.deadline, serverSample: clock.serverTime,
    serverSampleRoundTripMs: Math.round(clock.receivedAt - clock.requestStartedAt),
    approximateComputerClockAheadMs: Math.round(clock.wallClockAtReceipt - serverTime),
    observationAllowanceMs: graceMs, reads,
    observedAfterEstimatedDeadlineMs: observedAt === undefined ? null : Math.round(observedAt - dueAt),
    lastStatus: last?.status ?? null, lastRevision: last?.revision ?? null,
  });
  try {
    assert.ok(dueAt - now() <= 20000, 'The independent check must not wait longer than a twenty-second turn.');
    if (now() < dueAt) await wait(dueAt - now());
    while (true) {
      const remaining = Math.ceil(stopAt - now());
      if (remaining <= 0 && reads > 0) break;
      reads++;
      last = await readMatch(AbortSignal.timeout(Math.max(1, remaining)));
      observedAt = now();
      assert.equal(Date.parse(last.deadline), deadline, 'The server deadline must not change while waiting for Cron.');
      if (last.status === 'finished') {
        assert.ok(observedAt <= stopAt, 'Cron completion was not observed within the bounded timeout allowance.');
        assert.equal(last.end_reason, 'timeout', 'The independent finish must be a timeout.');
        assert.equal(last.winner_id, winnerId, 'The player whose turn expired must lose.');
        assert.deepEqual(last.state, match.state, 'Timeout must preserve the accepted match state.');
        assert.equal(last.revision, match.revision + 1, 'Timeout must finish the match exactly once.');
        assert.equal(Date.parse(last.ended_at), deadline, 'The effective finish time must remain the original deadline.');
        return { finished: last, diagnostics: diagnostics() };
      }
      if (observedAt >= stopAt) break;
      await wait(Math.min(pollMs, stopAt - observedAt));
    }
    throw new Error('Cron did not finish the match within the bounded timeout observation allowance.');
  } catch (error) {
    error.diagnostics = { ...error.diagnostics, timeout: diagnostics() };
    throw error;
  }
}

export async function runLiveSmoke() {
  const option = process.argv.find(value => value.startsWith('--category='));
  const category = option?.slice('--category='.length) ?? 'games';
  assert.ok(['games', 'movies', 'football'].includes(category), 'Category must be games, movies or football.');
  const opening = process.argv.find(value => value.startsWith('--opening='))?.slice('--opening='.length) ?? 'standard';
  assert.ok(['standard', 'familiar'].includes(opening), 'Opening must be standard or familiar.');
  assert.ok(category !== 'games' || opening === 'standard', 'Familiar starters are available for Movies and Football.');
  const configuration = validatePublicConfiguration({
    ...PREVIEW_CONFIGURATION,
    supabaseUrl: process.env.SUPABASE_URL ?? '',
    supabasePublishableKey: process.env.SUPABASE_PUBLISHABLE_KEY ?? '',
  });
  assert.ok(configuration.supabaseUrl, 'Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in web/.env.');
  const makeClient = () => createClient(configuration.supabaseUrl, configuration.supabasePublishableKey, {
    auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false },
  });
  const clients = [makeClient(), makeClient()];
  const streams = [];
  const verified = [];
  const skipped = [];
  let timeoutObservation;
  let phase = 'authentication';
  const command = async (index, action, payload, requestId = crypto.randomUUID()) => {
    const { data, error } = await clients[index].functions.invoke('match-api', { body: { action, payload, requestId } });
    if (error) {
      let message = error.message;
      if (error.context instanceof Response) {
        try { message = (await error.context.json()).error ?? message; } catch { /* Keep transport error. */ }
      }
      throw new Error(action + ': ' + safeMessage(message));
    }
    assert.ok(data, action + ': empty response');
    return data;
  };
  try {
    const identities = await Promise.all(clients.map(async client => {
      const { data, error } = await client.auth.signInAnonymously();
      if (error || !data.user || !data.session) throw error ?? new Error('Anonymous sign-in failed.');
      await client.realtime.setAuth(data.session.access_token);
      return data.user.id;
    }));
    assert.notEqual(identities[0], identities[1], 'The players must have distinct identities.');
    verified.push('two independent authenticated guest identities');
    phase = 'catalogue';
    const { data: publication, error: catalogueError } = await clients[0].from('catalogues')
      .select('id,snapshot').eq('published', true).eq('category_id', category)
      .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(1).single();
    if (catalogueError) throw catalogueError;
    const data = category !== 'games'
      ? JSON.parse(readFileSync(new URL('../data/' + category + '/published/' + publication.id + '/catalogue.json', import.meta.url), 'utf8'))
      : publication.snapshot;
    assert.equal(data.datasetId, publication.id, 'The local engine must use the published catalogue version.');
    const engine = category === 'movies' ? new MovieConnectionEngine(data) : category === 'football' ? new FootballConnectionEngine(data) : new ConnectionEngine(data);
    const indexFor = match => {
      const index = identities.indexOf(match.activePlayer);
      assert.ok(index >= 0, 'The active player must be one of the authenticated guests.');
      return index;
    };
    const best = match => {
      const available = engine.availableMoves(match.state);
      if (category !== 'games') return available[0];
      return available.sort((a, b) => {
        const aa = engine.applyMove(match.state, a), bb = engine.applyMove(match.state, b);
        return engine.availableMoves(bb.state).length - engine.availableMoves(aa.state).length;
      })[0];
    };
    phase = 'room';
    const room = (await command(0, 'create', { name: 'Smoke A', category, openingMode: opening })).room;
    assert.ok(room, 'Room creation did not return a room.');
    assert.equal(room.openingMode ?? 'standard', opening, 'The server must persist the selected opening mode.');
    await command(1, 'join', { code: room.code, name: 'Smoke B' });
    phase = 'database subscription readiness';
    console.log('[' + category + '] Waiting for both database streams before starting the match…');
    streams.push(...clients.map((client, i) => watchMatchUpdates(client, room.id, i + 1)));
    await Promise.all(streams.map(stream => stream.ready));
    verified.push('both Postgres Changes subscriptions confirmed ready before match start');
    phase = 'start and RLS reads';
    let match = (await command(0, 'start', { roomId: room.id })).match;
    assert.equal(match.category, category);
    assert.equal(match.catalogueId, publication.id);
    if (opening === 'familiar') {
      const { data: member, error } = await clients[0].from('opening_pool_entries').select('entry_id')
        .eq('pool_id', room.openingPoolId).eq('entry_id', match.state.currentGameId).single();
      if (error) throw error;
      assert.equal(member.entry_id, match.state.currentGameId, 'The seed must belong to the pinned familiar pool.');
      verified.push('saved familiar opening pool restricts the seed');
    }
    await Promise.all(clients.map(async (client, i) => {
      const { data: readable, error } = await client.from('matches').select('id,revision,status').eq('id', match.id).single();
      if (error) throw new Error('Player ' + (i + 1) + ' cannot read its own match: ' + error.message);
      assert.equal(readable.id, match.id);
    }));
    verified.push('private room join/start and both participant RLS reads');
    phase = 'invalid answer';
    const actor = indexFor(match);
    const rejected = await command(actor, 'submit', {
      matchId: match.id, entryId: match.state.currentGameId, expectedVersion: match.state.version,
    });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.reason, 'repeated_game');
    assert.deepEqual(rejected.match.state, match.state);
    assert.equal(rejected.match.deadline, match.deadline);
    verified.push('invalid answer preserves state and deadline');
    phase = 'valid move and duplicate receipt';
    const target = best(match);
    assert.ok(target, 'An opening seed must have a legal move.');
    const payload = { matchId: match.id, entryId: target, expectedVersion: match.state.version };
    const requestId = crypto.randomUUID();
    const duplicates = await Promise.all([command(actor, 'submit', payload, requestId), command(actor, 'submit', payload, requestId)]);
    assert.equal(duplicates.filter(result => result.duplicate).length, 1);
    assert.ok(duplicates.every(result => result.ok));
    match = (await command(actor, 'snapshot', { matchId: match.id })).match;
    assert.equal(match.state.version, 1);
    assert.deepEqual(engine.replay(match.state.history), match.state);
    assert.equal(Date.parse(match.deadline) - Date.parse(match.turns.at(-1).acceptedAt), 20000);
    verified.push('valid move, all shared counters, duplicate idempotency, and twenty-second deadline');
    phase = 'Realtime move delivery';
    await requireMoveDelivery(streams, match);
    verified.push('both clients received the accepted move through Realtime');
    phase = 'competing submissions';
    const next = best(match);
    if (next) {
      const version = match.state.version;
      const simultaneous = await Promise.all([0, 1].map(i => command(i, 'submit', { matchId: match.id, entryId: next, expectedVersion: version })));
      assert.equal(simultaneous.filter(result => result.ok).length, 1);
      match = (await command(0, 'snapshot', { matchId: match.id })).match;
      assert.equal(match.state.version, version + 1);
      assert.deepEqual(engine.replay(match.state.history), match.state);
      verified.push('exactly one competing submission accepted');
    } else skipped.push('competing submissions: no legal follow-up exists in this match');
    phase = 'session restoration';
    const { data: { session }, error: sessionError } = await clients[0].auth.getSession();
    if (sessionError || !session) throw sessionError ?? new Error('The original session is missing.');
    const restoredClient = makeClient();
    clients.push(restoredClient);
    const { error: restoreError } = await restoredClient.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
    if (restoreError) throw restoreError;
    const restoreStartedAt = performance.now();
    const restored = await command(2, 'snapshot', { matchId: match.id });
    const clock = {
      serverTime: restored.serverTime, requestStartedAt: restoreStartedAt,
      receivedAt: performance.now(), wallClockAtReceipt: Date.now(),
    };
    assert.deepEqual(restored.match.state, match.state);
    assert.equal(restored.match.status, 'active', 'Session restoration must complete before the turn expires.');
    assert.equal(restored.match.revision, match.revision);
    assert.equal(restored.match.deadline, match.deadline);
    verified.push('same-session restoration');
    phase = 'independent server timeout';
    await Promise.all(streams.map(stream => stream.stop()));
    console.log('[' + category + '] Waiting for the server deadline with no subscribers or game commands…');
    const expiry = await requireIndependentTimeout(async signal => {
      const { data: row, error } = await restoredClient.from('matches')
        .select('status,winner_id,state,end_reason,ended_at,deadline,revision')
        .eq('id', match.id).abortSignal(signal).single();
      if (error) throw new Error('Read-only timeout observation failed: ' + error.message);
      return row;
    }, match, clock);
    timeoutObservation = expiry.diagnostics;
    verified.push('Cron timeout without subscribers or game commands');
    phase = 'late answer';
    const late = await command(indexFor(match), 'submit', { matchId: match.id, entryId: best(match) ?? match.state.currentGameId, expectedVersion: match.state.version });
    assert.equal(late.ok, false);
    assert.deepEqual(late.match.state, match.state);
    verified.push('late answer rejection');
    return { passed: true, category, tests: verified, skipped, matchId: match.id, events: streams.map(stream => stream.events.length), timeout: timeoutObservation };
  } catch (error) {
    error.liveDiagnostics = { category, phase, completed: verified, ...(timeoutObservation ? { timeout: timeoutObservation } : {}), ...(error.diagnostics ?? {}), subscriptions: streams.map(stream => ({ ...stream.diagnostics, receivedUpdates: stream.events.length })) };
    throw error;
  } finally {
    await Promise.allSettled(streams.map(stream => stream.stop()));
    await Promise.allSettled(clients.map(async client => { await client.auth.stopAutoRefresh(); await client.removeAllChannels(); client.realtime.disconnect(); }));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await runLiveSmoke(), null, 2)); }
  catch (error) {
    console.error(JSON.stringify({ passed: false, error: safeMessage(error.message), ...error.liveDiagnostics }, null, 2));
    process.exitCode = 1;
  }
}
