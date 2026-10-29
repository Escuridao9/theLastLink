-- Hourly, bounded cleanup. Existing data receives a full 24-hour rollout grace.
begin;
select cron.schedule('last-link-cleanup-unused-data','7 * * * *',
  $$select public.cleanup_unused_data(false,50)$$);
commit;
