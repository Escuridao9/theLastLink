import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
const db = new PGlite();
const root = new URL("../", import.meta.url);
interface Match {
  id: string;
  roomId: string;
  activePlayer: string;
  deadline: string;
  status: string;
  state: { version: number };
  turns: { acceptedAt: string }[];
  rematch?: { nextMatchId: string | null };
}
interface Reply {
  room?: { id: string; code: string };
  match?: Match;
  duplicate?: boolean;
}
const sql = (name: string) =>
  readFileSync(new URL("supabase/migrations/" + name, root), "utf8");
async function command(
  uid: string,
  action: string,
  payload: object,
  request = randomUUID(),
): Promise<Reply> {
  return db.transaction(async (tx) => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [uid]);
    return (
      await tx.query<{ value: Reply }>(
        "select public.game_command($1,$2::jsonb,$3) value",
        [action, JSON.stringify(payload), request],
      )
    ).rows[0]!.value;
  });
}
async function user(guest = false) {
  const id = randomUUID();
  await db.query(
    `insert into auth.users(id,email,is_anonymous,email_confirmed_at) values($1,$2,$3,$4)`,
    [
      id,
      guest ? null : id + "@example.invalid",
      guest,
      guest ? null : new Date().toISOString(),
    ],
  );
  return id;
}
async function overview(
  uid: string,
  category: string | null = null,
  at: string | null = null,
  id: string | null = null,
  limit = 20,
): Promise<any> {
  return db.transaction(async (tx) => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [uid]);
    return (
      await tx.query<{ value: unknown }>(
        "select public.account_overview($1,$2,$3,$4) value",
        [category, at, id, limit],
      )
    ).rows[0]!.value;
  });
}
async function fresh(category = "games", guestOpponent = false) {
  const host = await user(),
    rival = await user(guestOpponent);
  const room = (await command(host, "create", { name: "Diogo", category }))
    .room!;
  await command(rival, "join", { name: "Diogo", code: room.code }); // Names intentionally need not be unique.
  const match = (await command(host, "start", { roomId: room.id })).match!;
  return { host, rival, room, match };
}
async function finish(category = "games", guestOpponent = false) {
  const f = await fresh(category, guestOpponent);
  f.match = (await command(f.host, "concede", { matchId: f.match.id })).match!;
  return f;
}
async function ageRoom(id: string) {
  await db.query(
    "update public.game_rooms set last_active_at=clock_timestamp()-interval '25 hours' where id=$1",
    [id],
  );
}
async function ageUser(id: string) {
  await db.query(
    "update auth.users set created_at=clock_timestamp()-interval '25 hours',last_sign_in_at=clock_timestamp()-interval '25 hours' where id=$1",
    [id],
  );
  await db.query(
    "update game_private.account_activity set last_active_at=clock_timestamp()-interval '25 hours' where user_id=$1",
    [id],
  );
}
async function cleanup(dryRun = false) {
  return (
    await db.query<{ value: any }>(
      "select public.cleanup_unused_data($1,50) value",
      [dryRun],
    )
  ).rows[0]!.value;
}
async function exists(table: string, id: string) {
  assert.ok(
    ["auth.users", "public.game_rooms", "public.matches"].includes(table),
  );
  return (
    (await db.query("select 1 from " + table + " where id=$1", [id])).rows
      .length === 1
  );
}
let retained: Awaited<ReturnType<typeof finish>>, commandSource: string;
before(async () => {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key,email text,email_change text default '',is_anonymous boolean default true,
      email_confirmed_at timestamptz,created_at timestamptz default now(),last_sign_in_at timestamptz default now());
    create table auth.identities(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users on delete cascade,provider text);
    create table auth.sessions(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users on delete cascade,created_at timestamptz default now());
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to anon,authenticated,service_role;
    grant execute on function auth.uid() to anon,authenticated,service_role;
    create publication supabase_realtime;`);
  for (const name of [
    "20261026150832_create_rooms_and_players.sql",
    "20261027140000_game.sql",
    "20261027140200_movies.sql",
    "20261028100000_football_and_familiar_starts.sql",
    "20261028120000_rematches.sql",
  ])
    await db.exec(sql(name));
  await db.exec(readFileSync(new URL("supabase/seed.sql", root), "utf8"));
  for (const category of ["movies", "football"]) {
    const catalogue = category + "-account-test";
    await db.query(
      "insert into public.catalogues(id,category_id,sha256,snapshot) values($1,$2,'test','{}')",
      [catalogue, category],
    );
    const person =
      category === "movies" ? "tmdb:person:901" : "wikidata:Q90001";
    await db.query(
      "insert into public.connector_entities values($1,'Synthetic person','{}') on conflict do nothing",
      [person],
    );
    for (const n of [1, 2, 3]) {
      const entry =
        category === "movies" ? "tmdb:movie:" + n : "wikidata:club:Q9000" + n;
      await db.query(
        "insert into public.entries values($1,$2,'Synthetic entry',null,'{}',true)",
        [catalogue, entry],
      );
      await db.query(
        "insert into public.entry_credits values($1,$2,$3,$4,'{}')",
        [catalogue, entry, person, category === "movies" ? "actor" : "player"],
      );
    }
    await db.query("update public.catalogues set published=true where id=$1", [
      catalogue,
    ]);
  }
  retained = await finish("movies");
  commandSource = (
    await db.query<{ body: string }>(
      "select prosrc body from pg_proc where oid='public.game_command(text,jsonb,uuid)'::regprocedure",
    )
  ).rows[0]!.body;
  await db.exec(sql("20261029120000_account_history_and_retention.sql"));
});
after(async () => {
  await db.close();
});

test("migration backfills retained registered results without rewriting gameplay or the twenty-second deadline", async () => {
  const before = await overview(retained.host);
  assert.equal(before.statistics.losses, 1);
  const source = (
    await db.query<{ body: string }>(
      "select prosrc body from pg_proc where oid='game_private.game_command_before_retention(text,jsonb,uuid)'::regprocedure",
    )
  ).rows[0]!.body;
  assert.equal(source, commandSource);
  const f = await fresh();
  assert.equal(
    Date.parse(f.match.deadline) - Date.parse(f.match.turns[0]!.acceptedAt),
    20000,
  );
});

test("registered results are private, grouped by category and counted once despite retries", async () => {
  for (const category of ["games", "movies", "football"]) {
    const f = await fresh(category);
    const request = randomUUID();
    await command(f.host, "concede", { matchId: f.match.id }, request);
    const duplicate = await command(
      f.host,
      "concede",
      { matchId: f.match.id },
      request,
    );
    assert.equal(duplicate.duplicate, true);
    assert.deepEqual((await overview(f.host)).statistics, {
      played: 1,
      wins: 0,
      losses: 1,
      winRate: 0,
    });
    const other = await overview(f.rival);
    assert.equal(other.statistics.wins, 1);
    assert.equal(other.history[0].opponent, "Diogo");
    assert.equal(other.categories[0].category, category);
    const stranger = await user();
    assert.equal((await overview(stranger)).history.length, 0);
    const visible = await db.transaction(async (tx) => {
      await tx.exec("set local role authenticated");
      await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [
        stranger,
      ]);
      return tx.query(
        "select * from public.match_summaries where player_id=$1",
        [f.host],
      );
    });
    assert.equal(visible.rows.length, 0);
  }
});

test("cleanup dry run has no effects and purging old details preserves compact results", async () => {
  const f = await finish("football", true);
  await ageRoom(f.room.id);
  await ageUser(f.rival);
  await db.query(
    "update game_private.command_receipts set created_at=clock_timestamp()-interval '25 hours' where player_id in ($1,$2)",
    [f.host, f.rival],
  );
  const before = await db.query("select count(*)::int n from public.matches");
  const dry = await cleanup(true);
  assert.equal(dry.dryRun, true);
  assert.ok(dry.rooms >= 1);
  assert.deepEqual(
    (await db.query("select count(*)::int n from public.matches")).rows,
    before.rows,
  );
  assert.equal(await exists("public.game_rooms", f.room.id), true);
  assert.equal(await exists("auth.users", f.rival), true);
  const removed = await cleanup();
  assert.equal(
    dry.guests,
    removed.guests,
    "Dry run includes guests released by the planned room removal",
  );
  assert.equal(
    dry.receipts,
    removed.receipts,
    "Room-associated receipts are not counted again as standalone receipts",
  );
  assert.equal(await exists("auth.users", f.rival), false);
  assert.equal(await exists("public.game_rooms", f.room.id), false);
  assert.equal(await exists("public.matches", f.match.id), false);
  const saved = await overview(f.host);
  assert.equal(saved.statistics.losses, 1);
  assert.equal(saved.history[0].detailsAvailable, false);
  assert.equal(saved.history[0].opponent, "Guest");
  await assert.rejects(
    command(f.host, "snapshot", { matchId: f.match.id }),
    /match_not_found/,
  );
});

test("visible activity, active games, pending rematches and pending registrations protect records", async () => {
  const active = await fresh();
  await ageRoom(active.room.id);
  const waitingHost = await user();
  const waiting = (
    await command(waitingHost, "create", { name: "Host", category: "games" })
  ).room!;
  await ageRoom(waiting.id);
  await command(waitingHost, "room", { roomId: waiting.id });
  const rematch = await finish();
  await command(rematch.host, "rematch", { matchId: rematch.match.id });
  await ageRoom(rematch.room.id);
  const pending = await user(true);
  await ageUser(pending);
  await db.query(
    "update auth.users set email_change='pending@example.invalid' where id=$1",
    [pending],
  );
  const freshGuest = await user(true);
  await ageUser(freshGuest);
  await db.transaction(async (tx) => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [
      freshGuest,
    ]);
    await tx.query("select public.account_heartbeat()");
  });
  await cleanup();
  for (const room of [active.room.id, waiting.id, rematch.room.id])
    assert.equal(await exists("public.game_rooms", room), true);
  for (const uid of [pending, freshGuest])
    assert.equal(await exists("auth.users", uid), true);
});

test("old unused guests and their sessions are removed while registered accounts remain", async () => {
  const guest = await user(true),
    registered = await user();
  await db.query(
    "insert into auth.sessions(user_id,created_at) values($1,clock_timestamp()-interval '25 hours')",
    [guest],
  );
  await ageUser(guest);
  await ageUser(registered);
  const result = await cleanup();
  assert.ok(result.guests >= 1);
  assert.equal(await exists("auth.users", guest), false);
  assert.equal(await exists("auth.users", registered), true);
  assert.equal(
    (await db.query("select 1 from auth.sessions where user_id=$1", [guest]))
      .rows.length,
    0,
  );
});

test("guest conversion preserves its ID and backfills only results still available", async () => {
  const f = await finish("movies", true);
  await assert.rejects(overview(f.rival), /registered_account_required/);
  await db.query(
    "update auth.users set is_anonymous=false,email=$2,email_confirmed_at=clock_timestamp() where id=$1",
    [f.rival, f.rival + "@example.invalid"],
  );
  assert.equal((await overview(f.rival)).statistics.wins, 1);
  await ageUser(f.rival);
  await cleanup();
  assert.equal(await exists("auth.users", f.rival), true);
});

test("only the owner backend can invoke account deletion and maintenance", async () => {
  for (const role of ["anon", "authenticated"]) {
    const permissions = (
      await db.query<{ deletion: boolean; cleanup: boolean }>(
        `select
      has_function_privilege($1,'public.delete_player_account(uuid)','EXECUTE') deletion,
      has_function_privilege($1,'public.cleanup_unused_data(boolean,integer)','EXECUTE') cleanup`,
        [role],
      )
    ).rows[0]!;
    assert.equal(permissions.deletion, false);
    assert.equal(permissions.cleanup, false);
  }
  assert.equal(
    (
      await db.query<{ allowed: boolean }>(
        "select has_function_privilege('service_role','public.delete_player_account(uuid)','EXECUTE') allowed",
      )
    ).rows[0]!.allowed,
    true,
  );
  await assert.rejects(
    overview(await user(), null, null, null, 0),
    /invalid_page/,
  );
});

test("history cursor resolves tied timestamps without skipping or repeating rows", async () => {
  const account = await user();
  const when = "2026-10-01T12:00:00.000Z";
  const ids = Array.from({ length: 5 }, () => randomUUID())
    .sort()
    .reverse();
  for (const id of ids)
    await db.query(
      `insert into public.match_summaries
    (player_id,match_id,opponent_name,category_id,finished_at,outcome,moves,end_reason)
    values($1,$2,'Guest','movies',$3,'win',4,'timeout')`,
      [account, id, when],
    );
  const page = await overview(account, "movies", null, null, 2);
  assert.equal(
    page.history.length,
    3,
    "The extra result indicates another page",
  );
  assert.deepEqual(
    page.history.slice(0, 2).map((row: any) => row.id),
    ids.slice(0, 2),
  );
  const cursor = page.history[1];
  const next = await overview(
    account,
    "movies",
    cursor.finishedAt,
    cursor.id,
    2,
  );
  assert.deepEqual(
    next.history.map((row: any) => row.id),
    ids.slice(2),
  );
  assert.equal(next.statistics.played, 5);
  assert.equal((await overview(account, "football")).history.length, 0);
});

test("account deletion concedes active play atomically and anonymises the opponent record", async () => {
  const f = await fresh("football");
  await db.query("insert into auth.sessions(user_id) values($1)", [f.host]);
  await db.query(
    "insert into auth.identities(user_id,provider) values($1,'email')",
    [f.host],
  );
  await db.query("select public.delete_player_account($1)", [f.host]);
  assert.equal(await exists("auth.users", f.host), false);
  assert.equal(await exists("public.game_rooms", f.room.id), false);
  assert.equal(
    (await db.query("select 1 from auth.sessions where user_id=$1", [f.host]))
      .rows.length,
    0,
  );
  const kept = await overview(f.rival);
  assert.equal(kept.statistics.wins, 1);
  assert.equal(kept.history[0].opponent, "Deleted player");
  assert.equal(kept.history[0].endReason, "conceded");
  assert.equal(kept.history[0].detailsAvailable, false);
  await assert.rejects(
    command(f.host, "create", { name: "Deleted player", category: "games" }),
    /account_unavailable/,
  );
});

test("failed Auth deletion rolls back conceded results, room removal and all personal data", async () => {
  const f = await fresh();
  await db.exec(`create function public.test_block_account_delete() returns trigger language plpgsql as $$begin raise exception 'simulated_auth_dependency'; end$$;
    create trigger zz_test_block_account_delete before delete on auth.users for each row execute function public.test_block_account_delete();`);
  try {
    await assert.rejects(
      db.query("select public.delete_player_account($1)", [f.host]),
      /simulated_auth_dependency/,
    );
  } finally {
    await db.exec(
      "drop trigger zz_test_block_account_delete on auth.users;drop function public.test_block_account_delete()",
    );
  }
  assert.equal(await exists("auth.users", f.host), true);
  assert.equal(await exists("public.game_rooms", f.room.id), true);
  assert.equal((await overview(f.rival)).statistics.played, 0);
  assert.equal(
    (await command(f.host, "snapshot", { matchId: f.match.id })).match!.status,
    "active",
  );
});
