-- Run after 0001. Memberships are provisioned only by an administrator in SQL.
begin;
create table public.cloud_memberships (
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text not null,
  role text not null check (role in ('owner','cashier','kitchen')),
  primary key (user_id, device_id)
);
alter table public.cloud_memberships enable row level security;
revoke all on public.cloud_memberships from authenticated;
grant select on public.cloud_memberships to authenticated;
revoke all on public.cloud_memberships from anon;
create policy membership_self on public.cloud_memberships for select to authenticated using (user_id = (select auth.uid()));

alter table public.payments add column request_id text;
-- NOT VALID preserves legacy rows for inspection; all new/changed rows are checked.
alter table public.orders add constraint orders_valid_amounts check (subtotal is not null and service is not null and tax is not null and total is not null and subtotal >= 0 and service >= 0 and tax >= 0 and total = subtotal + service + tax and status in ('open','paid','void')) not valid;
alter table public.payments add constraint payments_valid_amounts check (amount is not null and tendered is not null and change is not null and amount >= 0 and tendered >= amount and change = tendered - amount and method in ('cash','qris') and (method <> 'qris' or change = 0)) not valid;
alter table public.order_items add constraint items_valid_values check (qty is not null and price is not null and qty > 0 and price >= 0) not valid;
create unique index payments_request_unique on public.payments(device_id, request_id) where request_id is not null;
create table public.audit_events (
  device_id text not null, local_id bigint not null,
  action text not null check(action in ('payment','refund','void','shift_close')),
  order_local_id bigint, shift_local_id bigint not null,
  actor_local_id bigint not null, approver_local_id bigint,
  reason text not null, amount bigint not null, created_at bigint not null,
  primary key(device_id, local_id)
);
create table public.cloud_change_log (
  id bigint generated always as identity primary key,
  user_id uuid not null, device_id text not null, changes jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.cloud_change_log enable row level security;
revoke all on public.cloud_change_log from anon, authenticated;
grant select on public.cloud_change_log to authenticated;
create policy owner_log on public.cloud_change_log for select to authenticated using (
  exists(select 1 from public.cloud_memberships m where m.user_id = (select auth.uid()) and m.device_id = cloud_change_log.device_id and m.role = 'owner')
);

do $$
declare t text;
begin
  foreach t in array array['staff','shifts','products','dining_tables','orders','order_items','payments','audit_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists anon_all on public.%I', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy member_read on public.%I for select to authenticated using (exists (select 1 from public.cloud_memberships m where m.user_id = (select auth.uid()) and m.device_id = %I.device_id and (m.role = ''owner'' or (m.role = ''cashier'' and %L <> ''audit_events'') or (m.role = ''kitchen'' and %L in (''orders'',''order_items'',''dining_tables'')))))', t, t, t, t);
  end loop;
end $$;

create function public.apply_pos_changes(p_device text, p_changes jsonb, p_full boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare
  member_role text; change jsonb; row_data jsonb; tab text; operation text;
  cols text; updates text; id bigint;
begin
  select role into member_role from public.cloud_memberships where user_id = auth.uid() and device_id = p_device;
  if member_role is null or member_role not in ('owner','cashier') then raise exception 'Tidak berhak melakukan sync perangkat ini'; end if;
  if jsonb_typeof(p_changes) is distinct from 'array' then raise exception 'Batch tidak valid'; end if;
  if jsonb_array_length(p_changes) > 50000 then raise exception 'Batch terlalu besar'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_device, 0));
  if p_full then
    if member_role <> 'owner' then raise exception 'Sinkronisasi pertama membutuhkan akun owner'; end if;
    -- Reconcile old MVP rows once, including orphaned items left by the old sync.
    foreach tab in array array['staff','shifts','products','dining_tables','orders','order_items','payments','audit_events'] loop
      execute format('delete from public.%I where device_id = $1 and local_id not in (select (value->''row''->>''local_id'')::bigint from jsonb_array_elements($2) where value->>''table'' = $3 and value->>''op'' = ''put'')', tab) using p_device, p_changes, tab;
    end loop;
  end if;
  for change in select value from jsonb_array_elements(p_changes) loop
    tab := change->>'table'; operation := change->>'op'; row_data := change->'row';
    if tab is null or tab not in ('staff','shifts','products','dining_tables','orders','order_items','payments','audit_events') then raise exception 'Tabel tidak diizinkan'; end if;
    if operation is null or operation not in ('put','delete') then raise exception 'Operasi tidak valid'; end if;
    if (row_data->>'device_id') is distinct from p_device then raise exception 'Perangkat tidak cocok'; end if;
    id := (row_data->>'local_id')::bigint;
    if id is null or id < 1 then raise exception 'ID tidak valid'; end if;
    if member_role = 'cashier' and (tab in ('staff','products') or (operation = 'delete' and tab not in ('order_items'))) then raise exception 'Perubahan ini membutuhkan akun owner'; end if;
    if operation = 'delete' then
      execute format('delete from public.%I where device_id = $1 and local_id = $2', tab) using p_device, id;
    else
      -- Only declared columns are accepted; kitchen progress is owned by the kitchen RPC.
      row_data := row_data - 'kds_status';
      select string_agg(format('%I', column_name), ', ' order by ordinal_position),
             string_agg(format('%I = excluded.%I', column_name, column_name), ', ' order by ordinal_position) filter (where column_name not in ('device_id','local_id'))
        into cols, updates from information_schema.columns
        where table_schema = 'public' and table_name = tab and column_name <> 'kds_status';
      execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1) on conflict (device_id,local_id) do update set %s', tab, cols, cols, tab, updates) using row_data;
    end if;
  end loop;
  if jsonb_array_length(p_changes) > 0 then
    insert into public.cloud_change_log(user_id,device_id,changes) values(auth.uid(),p_device,p_changes);
  end if;
end $$;
revoke all on function public.apply_pos_changes(text,jsonb,boolean) from public, anon;
grant execute on function public.apply_pos_changes(text,jsonb,boolean) to authenticated;

create function public.advance_kitchen(p_device text, p_order bigint, p_expected text, p_next text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.cloud_memberships where user_id = auth.uid() and device_id = p_device and role in ('owner','kitchen')) then raise exception 'Akses dapur ditolak'; end if;
  if not ((p_expected = 'incoming' and p_next = 'cooking') or (p_expected = 'cooking' and p_next = 'ready')) then raise exception 'Perubahan status tidak valid'; end if;
  update public.orders set kds_status = p_next where device_id = p_device and local_id = p_order and kds_status = p_expected and status <> 'void';
  if not found then raise exception 'Pesanan telah berubah. Segarkan layar.'; end if;
  insert into public.cloud_change_log(user_id,device_id,changes) values(auth.uid(),p_device,jsonb_build_object('kitchen_order',p_order,'status',p_next));
end $$;
revoke all on function public.advance_kitchen(text,bigint,text,text) from public, anon;
grant execute on function public.advance_kitchen(text,bigint,text,text) to authenticated;
commit;
