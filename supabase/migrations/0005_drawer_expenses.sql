-- Run once after 0004. Keeps existing business records.
-- Expenses may now be paid from the cash drawer of a shift (shift_local_id).
begin;
alter table public.expenses add column shift_local_id bigint;

create or replace function public.apply_pos_changes(p_device text,p_changes jsonb,p_full boolean default false)
returns void language plpgsql security definer set search_path='' as $$
declare member_role text; core jsonb; extra jsonb; c jsonb; r jsonb;
begin
  select role into member_role from public.cloud_memberships where user_id=auth.uid() and device_id=p_device;
  if member_role is null or member_role not in ('owner','cashier') then raise exception 'Tidak berhak melakukan sync perangkat ini'; end if;
  if jsonb_typeof(p_changes) is distinct from 'array' or jsonb_array_length(p_changes)>50000 then raise exception 'Batch tidak valid'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_device,0));
  select coalesce(jsonb_agg(value),'[]'::jsonb) into core from jsonb_array_elements(p_changes) where value->>'table' is distinct from 'expenses';
  select coalesce(jsonb_agg(value),'[]'::jsonb) into extra from jsonb_array_elements(p_changes) where value->>'table'='expenses';
  if (jsonb_array_length(extra)>0 or p_full) and member_role<>'owner' then raise exception 'Pengeluaran dan bootstrap membutuhkan owner'; end if;
  perform public.apply_pos_changes_v3(p_device,core,p_full);
  if p_full then delete from public.expenses where device_id=p_device and local_id not in (select (value->'row'->>'local_id')::bigint from jsonb_array_elements(extra) where value->>'op'='put'); end if;
  for c in select value from jsonb_array_elements(extra) loop
    r:=c->'row';
    if (r->>'device_id') is distinct from p_device or (r->>'local_id') is null or (r->>'local_id')::bigint<1 then raise exception 'Identitas biaya tidak valid'; end if;
    if c->>'op'='put' then
      insert into public.expenses select * from jsonb_populate_record(null::public.expenses,r)
      on conflict(device_id,local_id) do update set date=excluded.date,category=excluded.category,description=excluded.description,amount=excluded.amount,actor_local_id=excluded.actor_local_id,created_at=excluded.created_at,voided_at=excluded.voided_at,void_reason=excluded.void_reason,shift_local_id=excluded.shift_local_id;
    elsif c->>'op'='delete' then delete from public.expenses where device_id=p_device and local_id=(r->>'local_id')::bigint;
    else raise exception 'Operasi biaya tidak valid'; end if;
  end loop;
  if jsonb_array_length(extra)>0 then insert into public.cloud_change_log(user_id,device_id,changes) values(auth.uid(),p_device,extra); end if;
end $$;
revoke all on function public.apply_pos_changes(text,jsonb,boolean) from public,anon;
grant execute on function public.apply_pos_changes(text,jsonb,boolean) to authenticated;
create or replace function public.pos_schema_version() returns int language sql stable set search_path='' as $$ select 5 $$;
commit;
