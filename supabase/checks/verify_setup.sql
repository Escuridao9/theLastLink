-- Read-only Dashboard checks after both migrations and seed.sql.
-- Run as the default administrator in SQL Editor; every passed field should be true.
select 'published catalogue v1' as check_name,
 exists(select 1 from public.catalogues where id='games-reviewed-2026-10-21-v1' and published) as passed
union all select '35 approved games', (select count(*) from public.entries where catalogue_id='games-reviewed-2026-10-21-v1')=35
union all select '165 approved eligible credits', (select count(*) from public.entry_credits where catalogue_id='games-reviewed-2026-10-21-v1')=165
union all select '61 compiled connections', (select count(*) from public.catalogue_edges where catalogue_id='games-reviewed-2026-10-21-v1')=61
union all select '20 eligible starting games', (select count(*) from public.entries where catalogue_id='games-reviewed-2026-10-21-v1' and seed_eligible)=20
union all select 'all 12 app tables have RLS', (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relname in ('categories','catalogues','entries','connector_entities','entry_credits','catalogue_edges','players','game_rooms','matches','match_participants','turn_history','connector_usage') and c.relrowsecurity)=12
union all select 'clients cannot update matches', not has_table_privilege('authenticated','public.matches','UPDATE')
union all select 'unsigned visitors cannot call game commands', not has_function_privilege('anon','public.game_command(text,jsonb,uuid)','EXECUTE')
union all select 'signed-in guests can call game commands', has_function_privilege('authenticated','public.game_command(text,jsonb,uuid)','EXECUTE')
union all select 'clients cannot run expiration worker', not has_function_privilege('authenticated','public.expire_due_matches()','EXECUTE')
union all select 'rooms enabled for Realtime', exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='game_rooms')
union all select 'matches enabled for Realtime', exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='matches')
union all select 'one-second expiration job active', exists(select 1 from cron.job where jobname='last-link-expire-turns' and schedule='1 second' and active);

-- These rows inspect the last runs, rather than expiring a match from this query.
select j.jobname, d.status, d.start_time, d.end_time, d.return_message
from cron.job_run_details d join cron.job j on j.jobid=d.jobid
where j.jobname='last-link-expire-turns' order by d.start_time desc limit 5;
