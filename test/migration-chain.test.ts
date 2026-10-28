import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

test('the complete migration chain preserves saved room data and enables independent 20-second matches', async () => {
  const db=new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to anon,authenticated,service_role;
      grant execute on function auth.uid() to anon,authenticated,service_role;
      create publication supabase_realtime;`);
    for(const name of ['20261026150832_create_rooms_and_players.sql','20261026161322_create_room_operation.sql','20261027090912_join_room_operation.sql'])
      await db.exec(readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));
    const host=randomUUID(),guest=randomUUID(),saved=randomUUID();
    await db.query('insert into auth.users values($1),($2)',[host,guest]);
    await db.query("insert into public.rooms(id,code,category_id,host_user_id) values($1,'SAVED1','games',$2)",[saved,host]);
    await db.query("insert into public.room_players(room_id,user_id,seat,display_name) values($1,$2,1,'Diogo')",[saved,host]);
    for(const name of ['20261027140000_game.sql','20261027140200_movies.sql'])
      await db.exec(readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));
    await db.exec(readFileSync(new URL('../supabase/migrations/20261027140300_publish_catalogues.sql',import.meta.url),'utf8'));
    assert.equal((await db.query<{count:number}>("select count(*)::int count from public.entries where catalogue_id='movies-tmdb-2017-v1'")).rows[0]!.count,3505);
    assert.equal((await db.query<{count:number}>("select count(*)::int count from public.entry_credits where catalogue_id='movies-tmdb-2017-v1'")).rows[0]!.count,99476);
    const additions = readdirSync(new URL('../supabase/migrations/', import.meta.url)).filter(n => n.startsWith('20261028')).sort();
    for (const name of additions) await db.exec(readFileSync(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8'));
    assert.equal((await db.query<{count:number}>("select count(*)::int count from public.entries where catalogue_id='football-clubs-2026-10-28-v1'")).rows[0]!.count,90);
    assert.equal((await db.query<{count:number}>("select count(*)::int count from public.entry_credits where catalogue_id='football-clubs-2026-10-28-v1'")).rows[0]!.count,31286);
    // Retrying a committed data publication must be safe if migration-history recording failed.
    for (const name of additions.filter(n => !n.endsWith('football_and_familiar_starts.sql')))
      await db.exec(readFileSync(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8'));
    assert.equal((await db.query<{allowed:boolean}>("select has_table_privilege('authenticated','public.rooms','SELECT') allowed")).rows[0]!.allowed,true);
    assert.equal((await db.query<{code:string}>('select code from public.rooms where id=$1',[saved])).rows[0]!.code,'SAVED1');
    assert.equal((await db.query('select * from public.room_players where room_id=$1',[saved])).rows.length,1);
    const command=async(uid:string,action:string,payload:object):Promise<any>=>db.transaction(async tx=>{
      await tx.exec('set local role authenticated');
      await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[uid]);
      return (await tx.query<{value:unknown}>('select public.game_command($1,$2::jsonb,$3) value',[action,JSON.stringify(payload),randomUUID()])).rows[0]!.value;
    });
    const room=(await command(host,'create',{name:'Diogo',category:'games'})).room;
    assert.equal(room.code.length,12);
    await command(guest,'join',{name:'Marta',code:room.code});
    const match=(await command(host,'start',{roomId:room.id})).match;
    assert.equal(Date.parse(match.deadline)-Date.parse(match.turns[0].acceptedAt),20000);
    assert.equal((await db.query('select * from public.game_rooms')).rows.length,1);
    for (const category of ['movies','football']) {
      const familiar=(await command(host,'create',{name:'Diogo',category,openingMode:'familiar'})).room;
      assert.equal(familiar.openingMode,'familiar');
      await command(guest,'join',{name:'Marta',code:familiar.code});
      const opened=(await command(host,'start',{roomId:familiar.id})).match;
      const allowed=await db.query('select entry_id from public.opening_pool_entries where pool_id=$1 and entry_id=$2',[familiar.openingPoolId,opened.state.currentGameId]);
      assert.equal(allowed.rows.length,1); assert.equal(opened.category,category);
      assert.equal(Date.parse(opened.deadline)-Date.parse(opened.turns[0].acceptedAt),20000);
    }
    const tables=(await db.query<{tablename:string}>("select tablename from pg_publication_tables where pubname='supabase_realtime'")).rows.map(r=>r.tablename);
    assert.ok(tables.includes('game_rooms')&&tables.includes('matches'));
  } finally { await db.close(); }
});
