-- Run once after 0005. Keeps existing business records.
-- Split bills: a part of an open table order paid separately becomes its own paid order that points
-- at the order it was split from, so the kitchen display can keep showing one ticket per table order.
begin;
alter table public.orders add column split_from_local_id bigint;
alter table public.orders add constraint orders_split_not_self check (split_from_local_id is null or split_from_local_id <> local_id) not valid;
-- apply_pos_changes copies every declared column, so the new column is synced without changing the RPC.
create or replace function public.pos_schema_version() returns int language sql stable set search_path='' as $$ select 6 $$;
commit;
