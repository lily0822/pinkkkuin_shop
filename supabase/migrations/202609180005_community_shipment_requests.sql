do $$ begin
  create type community_shipment_status as enum ('pending', 'processed', 'cancelled');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.community_shipment_requests (
  id uuid primary key default gen_random_uuid(),
  nickname text not null,
  order_ids uuid[] not null,
  recipient_name text not null,
  phone text not null,
  pickup_store text not null,
  status community_shipment_status not null default 'pending',
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint community_shipment_requests_order_ids_check check (array_length(order_ids, 1) > 0)
);

create index if not exists community_shipment_requests_nickname_idx
  on public.community_shipment_requests (lower(nickname));
create index if not exists community_shipment_requests_submitted_at_idx
  on public.community_shipment_requests (submitted_at desc);
create index if not exists community_shipment_requests_status_idx
  on public.community_shipment_requests (status);

drop trigger if exists community_shipment_requests_set_updated_at on public.community_shipment_requests;
create trigger community_shipment_requests_set_updated_at
before update on public.community_shipment_requests
for each row execute function set_updated_at();

alter table public.community_shipment_requests enable row level security;

revoke all on public.community_shipment_requests from anon;
revoke all on public.community_shipment_requests from authenticated;
revoke all on public.community_shipment_requests from service_role;
grant select, insert, update on public.community_shipment_requests to service_role;

create or replace function public.submit_community_shipment_request(
  p_nickname text,
  p_order_ids uuid[],
  p_recipient_name text,
  p_phone text,
  p_pickup_store text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nickname text := nullif(trim(coalesce(p_nickname, '')), '');
  v_recipient text := nullif(trim(coalesce(p_recipient_name, '')), '');
  v_phone text := nullif(trim(coalesce(p_phone, '')), '');
  v_store text := nullif(trim(coalesce(p_pickup_store, '')), '');
  v_matched_count integer;
  v_not_arrived_count integer;
  v_id uuid;
  v_submitted_at timestamptz;
begin
  if v_nickname is null or v_recipient is null or v_phone is null or v_store is null then
    raise exception 'invalid_input';
  end if;
  if p_order_ids is null or array_length(p_order_ids, 1) is null then
    raise exception 'no_orders';
  end if;

  select count(*) into v_matched_count
  from public.community_orders o
  where o.id = any(p_order_ids)
    and lower(trim(o.nickname)) = lower(v_nickname);

  if v_matched_count <> array_length(p_order_ids, 1) then
    raise exception 'order_nickname_mismatch';
  end if;

  select count(*) into v_not_arrived_count
  from public.community_orders o
  where o.id = any(p_order_ids)
    and o.arrival_status <> 'arrived_taiwan';

  if v_not_arrived_count > 0 then
    raise exception 'not_all_arrived';
  end if;

  insert into public.community_shipment_requests
    (nickname, order_ids, recipient_name, phone, pickup_store)
  values
    (v_nickname, p_order_ids, v_recipient, v_phone, v_store)
  returning id, submitted_at into v_id, v_submitted_at;

  return jsonb_build_object('id', v_id, 'submittedAt', v_submitted_at);
end;
$$;

create or replace function public.backend_list_community_shipment_requests(
  p_q text default '',
  p_page integer default 1,
  p_page_size integer default 50
)
returns table (
  total_count bigint,
  id uuid,
  nickname text,
  notebook_names text[],
  items jsonb,
  recipient_name text,
  phone text,
  pickup_store text,
  status text,
  submitted_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  with matched as (
    select s.*
    from public.community_shipment_requests s
    where nullif(trim(coalesce(p_q, '')), '') is null
      or s.nickname ilike '%' || trim(p_q) || '%'
      or s.recipient_name ilike '%' || trim(p_q) || '%'
      or exists (
        select 1 from public.community_orders o
        where o.id = any(s.order_ids) and o.notebook_name ilike '%' || trim(p_q) || '%'
      )
  ),
  paged as (
    select *, count(*) over()::bigint as total_count
    from matched
    order by submitted_at desc, id desc
    limit least(greatest(coalesce(p_page_size, 50), 1), 200)
    offset (greatest(coalesce(p_page, 1), 1) - 1) * least(greatest(coalesce(p_page_size, 50), 1), 200)
  )
  select
    p.total_count,
    p.id,
    p.nickname,
    (
      select array_agg(o.notebook_name order by o.notebook_name)
      from public.community_orders o
      where o.id = any(p.order_ids)
    ) as notebook_names,
    (
      select coalesce(jsonb_agg(jsonb_build_object(
        'productName', i.product_name,
        'variantSpec', i.variant_spec,
        'quantity', i.quantity
      ) order by i.created_at), '[]'::jsonb)
      from public.community_order_items i
      where i.order_id = any(p.order_ids)
    ) as items,
    p.recipient_name,
    p.phone,
    p.pickup_store,
    p.status::text,
    p.submitted_at
  from paged p
  order by p.submitted_at desc, p.id desc;
$$;

create or replace function public.backend_update_community_shipment_status(
  p_id uuid,
  p_status text
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.community_shipment_requests
  set status = p_status::community_shipment_status
  where id = p_id;
$$;

revoke all on function public.submit_community_shipment_request(text, uuid[], text, text, text) from public;
revoke all on function public.backend_list_community_shipment_requests(text, integer, integer) from public;
revoke all on function public.backend_update_community_shipment_status(uuid, text) from public;

grant execute on function public.submit_community_shipment_request(text, uuid[], text, text, text) to service_role;
grant execute on function public.backend_list_community_shipment_requests(text, integer, integer) to service_role;
grant execute on function public.backend_update_community_shipment_status(uuid, text) to service_role;
