-- Apply after 0002. This migration does not delete business rows.
begin;
alter table public.orders add column cashier_local_id bigint, add column paid_at bigint,
  add column cost_total bigint, add column cost_complete boolean, add column stock_returned boolean;
alter table public.orders add constraint orders_cost_valid check(cost_total is null or cost_total >= 0) not valid;
alter table public.order_items add column cost_total bigint;
alter table public.audit_events drop constraint audit_events_action_check;
alter table public.audit_events add constraint audit_events_action_check check(action in ('payment','refund','void','shift_close','receipt_copy'));

create table public.ingredients (
  device_id text not null, local_id bigint not null, name text not null,
  unit text not null check(unit in ('g','ml','pcs')),
  stock bigint not null check(stock >= 0), minimum bigint not null check(minimum >= 0),
  unit_cost numeric not null check(unit_cost >= 0), active int not null check(active in (0,1)),
  primary key(device_id,local_id)
);
create table public.recipes (
  device_id text not null, local_id bigint not null, ingredients jsonb not null check(jsonb_typeof(ingredients) = 'array'),
  primary key(device_id,local_id)
);
create table public.stock_movements (
  device_id text not null, local_id bigint not null, ingredient_local_id bigint not null,
  order_local_id bigint, kind text not null check(kind in ('opening','purchase','adjustment','sale','return')),
  qty bigint not null, unit_cost numeric not null check(unit_cost >= 0), reason text not null,
  actor_local_id bigint not null, created_at bigint not null,
  primary key(device_id,local_id)
);
do $$ declare t text; begin
  foreach t in array array['ingredients','recipes','stock_movements'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon, authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('create policy member_read on public.%I for select to authenticated using (exists(select 1 from public.cloud_memberships m where m.user_id = (select auth.uid()) and m.device_id = %I.device_id and m.role in (''owner'',''cashier'')))', t,t);
  end loop;
end $$;

alter function public.apply_pos_changes(text,jsonb,boolean) rename to apply_pos_changes_v2;
revoke all on function public.apply_pos_changes_v2(text,jsonb,boolean) from public,anon,authenticated;
create function public.apply_pos_changes(p_device text, p_changes jsonb, p_full boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare
  member_role text; core_changes jsonb; inventory_changes jsonb;
  change jsonb; row_data jsonb; previous jsonb; tab text; id bigint; cols text; updates text;
  old_stock bigint; delta bigint;
begin
  select role into member_role from public.cloud_memberships where user_id=auth.uid() and device_id=p_device;
  if member_role is null or member_role not in ('owner','cashier') then raise exception 'Tidak berhak melakukan sync perangkat ini'; end if;
  if jsonb_typeof(p_changes) is distinct from 'array' then raise exception 'Batch tidak valid'; end if;
  if jsonb_array_length(p_changes)>50000 then raise exception 'Batch terlalu besar'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_device,0));
  select coalesce(jsonb_agg(value),'[]'::jsonb) into core_changes from jsonb_array_elements(p_changes) where value->>'table' not in ('ingredients','recipes','stock_movements') or value->>'table' is null;
  select coalesce(jsonb_agg(value),'[]'::jsonb) into inventory_changes from jsonb_array_elements(p_changes) where value->>'table' in ('ingredients','recipes','stock_movements');
  perform public.apply_pos_changes_v2(p_device,core_changes,p_full);
  if p_full then
    if member_role <> 'owner' then raise exception 'Bootstrap membutuhkan owner'; end if;
    foreach tab in array array['ingredients','recipes','stock_movements'] loop
      execute format('delete from public.%I where device_id=$1 and local_id not in (select (value->''row''->>''local_id'')::bigint from jsonb_array_elements($2) where value->>''table''=$3 and value->>''op''=''put'')',tab) using p_device,inventory_changes,tab;
    end loop;
  end if;
  -- Cashier stock changes must be paired with new immutable sale/return movements.
  if member_role='cashier' then
    for change in select value from jsonb_array_elements(inventory_changes) loop
      tab:=change->>'table'; row_data:=change->'row'; id:=(row_data->>'local_id')::bigint;
      if change->>'op' is distinct from 'put' or tab='recipes' then raise exception 'Perubahan stok/resep ini membutuhkan owner'; end if;
      if tab='ingredients' then
        select to_jsonb(i),i.stock into previous,old_stock from public.ingredients i where device_id=p_device and local_id=id;
        if previous is null or (previous - 'stock' - 'unit_cost') is distinct from (row_data - 'stock' - 'unit_cost') then raise exception 'Metadata bahan hanya dapat diubah owner'; end if;
        select coalesce(sum((c.value->'row'->>'qty')::bigint),0) into delta from jsonb_array_elements(inventory_changes) c
          where c.value->>'table'='stock_movements' and (c.value->'row'->>'ingredient_local_id')::bigint=id
          and not exists(select 1 from public.stock_movements m where m.device_id=p_device and m.local_id=(c.value->'row'->>'local_id')::bigint);
        if (row_data->>'stock')::bigint <> old_stock + delta then raise exception 'Stok tidak cocok dengan pergerakan'; end if;
      elsif tab='stock_movements' then
        if row_data->>'kind' not in ('sale','return') or (row_data->>'order_local_id') is null then raise exception 'Kasir hanya boleh mencatat bahan penjualan/pengembalian'; end if;
        if (row_data->>'kind'='sale' and (row_data->>'qty')::bigint>=0) or (row_data->>'kind'='return' and (row_data->>'qty')::bigint<=0) then raise exception 'Arah pergerakan stok tidak valid'; end if;
        select to_jsonb(m) into previous from public.stock_movements m where device_id=p_device and local_id=id;
        if previous is not null and previous is distinct from row_data then raise exception 'Pergerakan lama tidak boleh diubah kasir'; end if;
        if not exists(select 1 from public.orders o where o.device_id=p_device and o.local_id=(row_data->>'order_local_id')::bigint and o.status in ('paid','void') and (row_data->>'kind'<>'return' or o.status='void')) then raise exception 'Pergerakan harus merujuk transaksi lunas atau refund'; end if;
        if previous is null and not exists(select 1 from jsonb_array_elements(inventory_changes) c where c.value->>'table'='ingredients' and (c.value->'row'->>'local_id')::bigint=(row_data->>'ingredient_local_id')::bigint) then raise exception 'Pergerakan harus disertai saldo bahan'; end if;
      end if;
    end loop;
  end if;
  for change in select value from jsonb_array_elements(inventory_changes) loop
    tab:=change->>'table'; row_data:=change->'row'; id:=(row_data->>'local_id')::bigint;
    if (row_data->>'device_id') is distinct from p_device or id is null or id<1 then raise exception 'Identitas bahan tidak valid'; end if;
    if change->>'op'='delete' then
      if member_role<>'owner' then raise exception 'Penghapusan membutuhkan owner'; end if;
      execute format('delete from public.%I where device_id=$1 and local_id=$2',tab) using p_device,id;
    elsif change->>'op'='put' then
      select string_agg(format('%I',column_name),', ' order by ordinal_position),
        string_agg(format('%I=excluded.%I',column_name,column_name),', ' order by ordinal_position) filter(where column_name not in ('device_id','local_id'))
      into cols,updates from information_schema.columns where table_schema='public' and table_name=tab;
      execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I,$1) on conflict(device_id,local_id) do update set %s',tab,cols,cols,tab,updates) using row_data;
    else raise exception 'Operasi tidak valid'; end if;
  end loop;
  if jsonb_array_length(inventory_changes)>0 then insert into public.cloud_change_log(user_id,device_id,changes) values(auth.uid(),p_device,inventory_changes); end if;
end $$;
revoke all on function public.apply_pos_changes(text,jsonb,boolean) from public,anon;
grant execute on function public.apply_pos_changes(text,jsonb,boolean) to authenticated;
create function public.pos_schema_version() returns int language sql stable set search_path='' as $$ select 3 $$;
revoke all on function public.pos_schema_version() from public,anon;
grant execute on function public.pos_schema_version() to authenticated;
commit;
