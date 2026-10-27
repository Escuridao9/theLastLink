-- Read only. Run as the project owner after migration 003 and the 38 movie import files.
select 'Movies category has exactly five roles' check_name,
 (select eligible_roles from public.categories where id='movies')=array['actor','director','writer','composer','cinematographer'] passed
union all select 'Movie catalogue published',exists(select 1 from public.catalogues where id='movies-tmdb-2017-v1' and category_id='movies' and published)
union all select '3505 playable films',(select count(*) from public.entries where catalogue_id='movies-tmdb-2017-v1')=3505
union all select '99476 eligible role credits',(select count(*) from public.entry_credits where catalogue_id='movies-tmdb-2017-v1')=99476
union all select '50516 distinct people',(select count(distinct entity_id) from public.entry_credits where catalogue_id='movies-tmdb-2017-v1')=50516
union all select '3479 seed films',(select count(*) from public.entries where catalogue_id='movies-tmdb-2017-v1' and seed_eligible)=3479
union all select 'Movie pair edges not required',not exists(select 1 from public.catalogue_edges where catalogue_id='movies-tmdb-2017-v1')
union all select 'Person intersection index exists',exists(select 1 from pg_indexes where schemaname='public' and indexname='credits_person_lookup')
union all select '35 Games remain',(select count(*) from public.entries where catalogue_id='games-reviewed-2026-10-21-v1')=35
union all select '165 Games credits remain',(select count(*) from public.entry_credits where catalogue_id='games-reviewed-2026-10-21-v1')=165
union all select '61 Games edges remain',(select count(*) from public.catalogue_edges where catalogue_id='games-reviewed-2026-10-21-v1')=61
union all select 'Room category column exists',exists(select 1 from information_schema.columns where table_schema='public' and table_name='rooms' and column_name='category_id')
union all select 'Clients cannot alter credits',not has_table_privilege('authenticated','public.entry_credits','INSERT,UPDATE,DELETE')
union all select 'Visitors can read published movie details',has_function_privilege('anon','public.movie_credit_details(text,text)','EXECUTE')
union all select 'Visitors cannot invoke internal intersections',not has_function_privilege('anon','game_private.shared_connectors(text,text,text)','EXECUTE');

select c.role,count(*) as published_credits from public.entry_credits c
where catalogue_id='movies-tmdb-2017-v1' group by c.role order by c.role;
