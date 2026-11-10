-- Kedai Rakdjat POS — cloud schema (Supabase)
-- Tablet is the local-first source of truth and pushes upserts keyed by (device_id, local_id).
-- Owner dashboard & KDS read from these tables.

create table if not exists public.staff (
  device_id text not null,
  local_id bigint not null,
  name text not null,
  role text not null,
  primary key (device_id, local_id)
);

create table if not exists public.shifts (
  device_id text not null,
  local_id bigint not null,
  staff_local_id bigint,
  status text not null,
  opened_at bigint,
  opening_float bigint default 0,
  closed_at bigint,
  actual_cash bigint,
  note text,
  primary key (device_id, local_id)
);

create table if not exists public.products (
  device_id text not null,
  local_id bigint not null,
  name text not null,
  category text,
  price bigint not null,
  active int default 1,
  primary key (device_id, local_id)
);

create table if not exists public.dining_tables (
  device_id text not null,
  local_id bigint not null,
  name text not null,
  status text not null,
  primary key (device_id, local_id)
);

create table if not exists public.orders (
  device_id text not null,
  local_id bigint not null,
  shift_local_id bigint,
  status text not null,
  created_at bigint,
  subtotal bigint default 0,
  service bigint default 0,
  tax bigint default 0,
  total bigint default 0,
  order_type text,
  table_local_id bigint,
  kds_status text default 'incoming',
  primary key (device_id, local_id)
);

create table if not exists public.order_items (
  device_id text not null,
  local_id bigint not null,
  order_local_id bigint,
  product_local_id bigint,
  name text,
  qty int default 1,
  price bigint default 0,
  primary key (device_id, local_id)
);

create table if not exists public.payments (
  device_id text not null,
  local_id bigint not null,
  order_local_id bigint,
  shift_local_id bigint,
  method text,
  amount bigint default 0,
  tendered bigint default 0,
  change bigint default 0,
  created_at bigint,
  primary key (device_id, local_id)
);

-- MVP: single-owner private POS. Anon key is treated as a shared secret for the kedai;
-- RLS is enabled with permissive policies so the tablet (push) and owner/KDS (read) work
-- without user auth. Tighten to authenticated roles before multi-tenant use.
alter table public.staff enable row level security;
alter table public.shifts enable row level security;
alter table public.products enable row level security;
alter table public.dining_tables enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;

do $$
declare t text;
begin
  foreach t in array array['staff','shifts','products','dining_tables','orders','order_items','payments'] loop
    execute format('drop policy if exists "anon_all" on public.%I', t);
    execute format('create policy "anon_all" on public.%I for all to anon using (true) with check (true)', t);
  end loop;
end $$;