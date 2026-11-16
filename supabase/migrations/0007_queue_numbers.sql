-- Run once after 0006. Keeps existing business records.
-- Kedai Rakdjat no longer seats guests at tables: each order gets a queue number (restarting every
-- shift) and an optional customer name, shown on the kitchen ticket and the KDS.
begin;
alter table public.orders add column queue_no integer;
alter table public.orders add column customer_name text;
alter table public.orders add constraint orders_queue_no_positive check (queue_no is null or queue_no > 0) not valid;
alter table public.orders add constraint orders_customer_name_length check (customer_name is null or char_length(customer_name) between 1 and 30) not valid;
-- apply_pos_changes copies every declared column, so the new columns are synced without changing the RPC.
create or replace function public.pos_schema_version() returns int language sql stable set search_path='' as $$ select 7 $$;
commit;
