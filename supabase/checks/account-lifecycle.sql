-- Run as the project owner in Supabase SQL Editor after both account migrations.
-- Aggregate diagnostics only. The cleanup invocation below does not delete data.
select
  (select count(*) from auth.users where is_anonymous is false) as registered_accounts,
  (select count(*) from auth.users where is_anonymous is true) as guest_accounts,
  (select count(*) from public.game_rooms) as rooms,
  (select count(*) from public.matches) as detailed_rounds,
  (select count(*) from public.match_summaries) as private_summaries;

select public.cleanup_unused_data(true,50) as cleanup_preview;

select jobid,jobname,schedule,active
from cron.job
where jobname in ('last-link-expire-turns','last-link-cleanup-unused-data')
order by jobname;

select job.jobname,run.status,run.start_time,run.end_time,run.return_message
from cron.job job
left join lateral (
  select status,start_time,end_time,return_message
  from cron.job_run_details where jobid=job.jobid
  order by start_time desc limit 3
) run on true
where job.jobname in ('last-link-expire-turns','last-link-cleanup-unused-data')
order by job.jobname,run.start_time desc;
-- A newly scheduled job has NULL run fields until its first execution.

select
  has_function_privilege('authenticated','public.delete_player_account(uuid)','execute') as browser_can_delete_directly,
  has_function_privilege('authenticated','public.cleanup_unused_data(boolean,integer)','execute') as browser_can_cleanup,
  has_function_privilege('service_role','public.delete_player_account(uuid)','execute') as server_can_delete;
-- Expected privileges: false, false, true.
