import { test } from 'node:test';
import assert from 'node:assert/strict';

// Importing the check does not authenticate or run its live command entry point.
const { watchMatchUpdates, requireMoveDelivery, requireIndependentTimeout } = await import(
  new URL('../scripts/live-smoke.mjs', import.meta.url).href
);

type Message = Record<string, unknown>;
function fakeClient() {
  const handlers = new Map<string, (message: Message) => void>();
  let subscriber: ((status: string, error?: Error) => void) | undefined;
  let options: unknown;
  let removed = false;
  const channel = {
    on(event: string, _filter: unknown, callback: (message: Message) => void) {
      handlers.set(event, callback);
      return channel;
    },
    subscribe(callback: (status: string, error?: Error) => void) {
      subscriber = callback;
      return channel;
    },
  };
  const client = {
    channel(_name: string, configuration: unknown) { options = configuration; return channel; },
    async removeChannel(value: unknown) { assert.equal(value, channel); removed = true; },
  };
  return {
    client, options: () => options, removed: () => removed,
    status(status: string, error?: Error) {
      assert.ok(subscriber);
      subscriber(status, error);
    },
    emit(event: string, message: Message) {
      const callback = handlers.get(event);
      assert.ok(callback);
      callback(message);
    },
  };
}
const expected = { id: 'test-match', revision: 1 };
const accepted = { new: { ...expected, status: 'active' } };

test('live check requests database readiness and waits for SDK confirmation', async () => {
  const fake = fakeClient();
  const stream = watchMatchUpdates(fake.client, 'test-room', 1, 1000);
  assert.deepEqual(fake.options(), {
    config: { postgres_changes_options: { wait: true, timeout: 10000 } },
  });
  let confirmed = false;
  const confirmation = stream.ready.then(() => { confirmed = true; });
  await Promise.resolve();
  assert.equal(confirmed, false, 'Creating a channel is not database readiness.');
  fake.status('SUBSCRIBED');
  await confirmation;
  assert.equal(confirmed, true);
  assert.equal(stream.diagnostics.databaseReady, true);
  await stream.stop();
  assert.equal(fake.removed(), true);
});

test('live check reports a subscription failure before running the match', async () => {
  const fake = fakeClient();
  const stream = watchMatchUpdates(fake.client, 'test-room', 1, 1000);
  const rejection = assert.rejects(stream.ready, /CHANNEL_ERROR.*configuration unavailable/);
  fake.status('CHANNEL_ERROR', new Error('configuration unavailable'));
  await rejection;
  assert.equal(stream.diagnostics.databaseReady, false);
  await stream.stop();
});

test('live check accepts delayed real callback delivery from both clients', async () => {
  const fakes = [fakeClient(), fakeClient()];
  const streams = fakes.map((fake, index) => watchMatchUpdates(fake.client, 'test-room', index + 1, 1000));
  fakes.forEach(fake => fake.status('SUBSCRIBED'));
  await Promise.all(streams.map(stream => stream.ready));
  const timers = [
    setTimeout(() => fakes[0]!.emit('postgres_changes', accepted), 10),
    setTimeout(() => fakes[1]!.emit('postgres_changes', accepted), 75),
  ];
  try { await requireMoveDelivery(streams, expected, 500); }
  finally {
    timers.forEach(clearTimeout);
    await Promise.all(streams.map(stream => stream.stop()));
  }
  assert.deepEqual(streams.map(stream => stream.events.length), [1, 1]);
});

test('a single recipient cannot pass the two-client check and diagnostics identify it', async () => {
  const fakes = [fakeClient(), fakeClient()];
  const streams = fakes.map((fake, index) => watchMatchUpdates(fake.client, 'test-room', index + 1, 1000));
  fakes.forEach(fake => fake.status('SUBSCRIBED'));
  await Promise.all(streams.map(stream => stream.ready));
  fakes[0]!.emit('postgres_changes', accepted);
  try {
    await assert.rejects(requireMoveDelivery(streams, expected, 20), (error: unknown) => {
      assert.ok(error instanceof Error);
      const report = error as Error & { diagnostics: { clients: { matchingMoveReceived: boolean; receivedUpdates: number }[] } };
      assert.deepEqual(report.diagnostics.clients.map(client => client.matchingMoveReceived), [true, false]);
      assert.deepEqual(report.diagnostics.clients.map(client => client.receivedUpdates), [1, 0]);
      return true;
    });
  } finally { await Promise.all(streams.map(stream => stream.stop())); }
});

test('another match or a timeout notification cannot be counted as the accepted move', async () => {
  const fakes = [fakeClient(), fakeClient()];
  const streams = fakes.map((fake, index) => watchMatchUpdates(fake.client, 'test-room', index + 1, 1000));
  fakes.forEach(fake => {
    fake.status('SUBSCRIBED');
    fake.emit('postgres_changes', { new: { id: 'another-match', revision: 1, status: 'active' } });
    fake.emit('postgres_changes', { new: { ...expected, status: 'finished' } });
  });
  await Promise.all(streams.map(stream => stream.ready));
  try { await assert.rejects(requireMoveDelivery(streams, expected, 20), /must receive the accepted move/); }
  finally { await Promise.all(streams.map(stream => stream.stop())); }
});

test('system failures are surfaced with token values redacted', async () => {
  const fake = fakeClient();
  const stream = watchMatchUpdates(fake.client, 'test-room', 1, 1000);
  const rejection = assert.rejects(stream.ready, /redacted JWT/);
  fake.emit('system', {
    extension: 'postgres_changes', status: 'error',
    message: 'Rejected eyJ0ZXN0.payload.signature and sb_secret_synthetic_test_value',
  });
  await rejection;
  const message: string = stream.diagnostics.system[0].message;
  assert.equal(message.includes('eyJ0ZXN0.payload.signature'), false);
  assert.equal(message.includes('sb_secret_synthetic_test_value'), false);
  await stream.stop();
});

function timeoutScenario(computerClockAheadMs = 0) {
  const serverEpoch = Date.parse('2026-10-27T12:00:00.000Z');
  let elapsed = 100;
  const waits: number[] = [];
  const clock = {
    serverTime: new Date(serverEpoch).toISOString(), requestStartedAt: 80,
    receivedAt: elapsed, wallClockAtReceipt: serverEpoch + computerClockAheadMs,
  };
  const match = {
    id: 'timeout-match', status: 'active', activePlayer: 'alice', revision: 2,
    deadline: new Date(serverEpoch + 20000).toISOString(),
    state: { version: 2, history: ['seed', 'answer-one', 'answer-two'], usage: { composer: 2 } },
    room: { players: [{ id: 'alice' }, { id: 'bob' }] },
  };
  const active = {
    status: 'active', winner_id: null, state: match.state, end_reason: null,
    ended_at: null, deadline: match.deadline, revision: match.revision,
  };
  const finished = {
    ...active, status: 'finished', winner_id: 'bob', end_reason: 'timeout',
    ended_at: match.deadline, revision: match.revision + 1,
  };
  return {
    clock, match, active, finished, waits,
    now: () => elapsed,
    options: {
      now: () => elapsed,
      wait: async (ms: number) => { waits.push(ms); elapsed += ms; },
    },
  };
}

test('independent timeout uses server time with either a fast or slow PC clock', async () => {
  for (const offset of [120000, -120000]) {
    const scenario = timeoutScenario(offset);
    const reads: number[] = [];
    const result = await requireIndependentTimeout(async (signal: AbortSignal) => {
      assert.equal(signal.aborted, false);
      reads.push(scenario.now());
      return scenario.now() < 21100 ? scenario.active : scenario.finished;
    }, scenario.match, scenario.clock, scenario.options);
    assert.equal(scenario.waits[0], 20000, 'A PC clock difference must not shorten or extend the turn wait.');
    assert.deepEqual(reads, [20100, 20350, 20600, 20850, 21100]);
    assert.equal(result.diagnostics.observedAfterEstimatedDeadlineMs, 1000);
    assert.equal(result.diagnostics.approximateComputerClockAheadMs, offset);
    assert.equal(result.finished.ended_at, scenario.match.deadline);
  }
});

test('independent timeout tolerates short scheduling delay but fails if Cron never finishes', async () => {
  const scenario = timeoutScenario();
  await assert.rejects(
    requireIndependentTimeout(async () => scenario.active, scenario.match, scenario.clock, scenario.options),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Cron did not finish/);
      const report = error as Error & { diagnostics: { timeout: { reads: number; lastStatus: string; observationAllowanceMs: number } } };
      assert.equal(report.diagnostics.timeout.lastStatus, 'active');
      assert.equal(report.diagnostics.timeout.observationAllowanceMs, 5000);
      assert.ok(report.diagnostics.timeout.reads > 1);
      return true;
    },
  );
  assert.equal(scenario.now(), 25100, 'A missing Cron result must not cause an unlimited wait.');
  assert.equal(scenario.active.deadline, scenario.match.deadline);
});

test('independent timeout rejects an already-finished setup instead of crediting Cron', async () => {
  const scenario = timeoutScenario();
  let reads = 0;
  await assert.rejects(requireIndependentTimeout(async () => {
    reads++;
    return scenario.finished;
  }, { ...scenario.match, status: 'finished' }, scenario.clock, scenario.options), /must still be active/);
  assert.equal(reads, 0);
});

test('timeout observation rejects a changed deadline even while the match is active', async () => {
  const scenario = timeoutScenario();
  await assert.rejects(requireIndependentTimeout(async () => ({
    ...scenario.active, deadline: '2026-10-27T12:00:30.000Z',
  }), scenario.match, scenario.clock, scenario.options), /deadline must not change/);
});

test('timeout keeps the exact winner, state, revision and effective deadline requirements', async () => {
  const invalidRows = [
    { end_reason: 'conceded', message: /must be a timeout/ },
    { winner_id: 'alice', message: /turn expired must lose/ },
    { state: { version: 99 }, message: /preserve the accepted match state/ },
    { revision: 4, message: /exactly once/ },
    { ended_at: '2026-10-27T12:00:23.000Z', message: /original deadline/ },
  ];
  for (const invalid of invalidRows) {
    const { message, ...fields } = invalid;
    const scenario = timeoutScenario();
    await assert.rejects(requireIndependentTimeout(async () => ({
      ...scenario.finished, ...fields,
    }), scenario.match, scenario.clock, scenario.options), message);
  }
});

test('a late finished response cannot silently widen the timeout observation allowance', async () => {
  const scenario = timeoutScenario();
  await assert.rejects(requireIndependentTimeout(async () => {
    await scenario.options.wait(5001);
    return scenario.finished;
  }, scenario.match, scenario.clock, scenario.options), /not observed within the bounded timeout allowance/);
});

test('read failures retain timeout diagnostics and do not substitute a game command', async () => {
  const scenario = timeoutScenario();
  await assert.rejects(requireIndependentTimeout(async () => {
    throw new Error('Database read unavailable');
  }, scenario.match, scenario.clock, scenario.options), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /Database read unavailable/);
    const report = error as Error & { diagnostics: { timeout: { matchId: string; reads: number } } };
    assert.equal(report.diagnostics.timeout.matchId, scenario.match.id);
    assert.equal(report.diagnostics.timeout.reads, 1);
    return true;
  });
});

test('independent timeout refuses an invalid server clock before reading a match', async () => {
  const scenario = timeoutScenario();
  let reads = 0;
  await assert.rejects(requireIndependentTimeout(async () => {
    reads++;
    return scenario.finished;
  }, scenario.match, { ...scenario.clock, serverTime: 'invalid' }, scenario.options), /valid server timestamps/);
  assert.equal(reads, 0);
});
