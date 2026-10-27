-- Supabase pg_cron supports second intervals. Fail deployment if Cron is unavailable:
-- silently falling back to client-triggered expiry would break Sudden Death.
create extension if not exists pg_cron;
select cron.schedule('last-link-expire-turns','1 second','select public.expire_due_matches()');
-- Bound run-log growth on the free plan. This does not remove match history.
select cron.schedule('last-link-prune-cron-log','17 3 * * *',
  $$delete from cron.job_run_details where end_time < now()-interval '1 day'$$);
