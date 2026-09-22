alter table public.community_shipment_requests
  alter column status drop default;

drop function if exists public.backend_update_community_shipment_status(uuid, text);

alter table public.community_shipment_requests
  alter column status type text using status::text;

update public.community_shipment_requests
set status = 'accepted'
where status = 'processed';

drop type if exists public.community_shipment_status;

alter table public.community_shipment_requests
  drop constraint if exists community_shipment_requests_status_check;

alter table public.community_shipment_requests
  add constraint community_shipment_requests_status_check
    check (status in ('pending', 'accepted', 'completed', 'cancelled')),
  alter column status set default 'pending';

alter table public.community_shipment_requests
  add column if not exists shipping_method text not null default 'seven_eleven',
  add column if not exists notebook_snapshot jsonb not null default '[]'::jsonb,
  add column if not exists marketplace_url text,
  add column if not exists marketplace_order_ref text,
  add column if not exists accepted_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists cancelled_at timestamptz;

update public.community_shipment_requests s
set notebook_snapshot = coalesce((
  select jsonb_agg(jsonb_build_object(
    'orderId', o.id,
    'notebookName', o.notebook_name,
    'amount', coalesce((
      select sum(i.subtotal) filter (where i.purchase_status = 'bought')
      from public.community_order_items i
      where i.order_id = o.id
    ), 0),
    'paymentStatus', o.payment_status::text,
    'arrivalStatus', case when not exists (
      select 1
      from public.community_order_items i
      where i.order_id = o.id
        and i.purchase_status = 'bought'
        and i.arrival_status <> 'arrived'
    ) then 'arrived' else 'not_arrived' end,
    'boughtItemCount', (
      select count(*)
      from public.community_order_items i
      where i.order_id = o.id and i.purchase_status = 'bought'
    )
  ) order by o.notebook_name)
  from public.community_orders o
  where o.id = any(s.order_ids)
), '[]'::jsonb)
where jsonb_array_length(s.notebook_snapshot) = 0;

do $$ begin
  alter table public.community_shipment_requests
    add constraint community_shipment_requests_method_check
    check (shipping_method in ('seven_eleven', 'face_to_face'));
exception
  when duplicate_object then null;
end $$;

create index if not exists community_shipment_requests_active_orders_idx
  on public.community_shipment_requests using gin (order_ids)
  where status <> 'cancelled';

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
  v_order_ids uuid[];
  v_matched_count integer;
  v_unpaid_count integer;
  v_not_arrived_count integer;
  v_empty_count integer;
  v_snapshot jsonb;
  v_id uuid;
  v_submitted_at timestamptz;
begin
  if v_nickname is null or v_recipient is null or v_phone is null or v_store is null then
    raise exception 'invalid_input';
  end if;
  if p_order_ids is null or array_length(p_order_ids, 1) is null then
    raise exception 'no_orders';
  end if;

  select array_agg(distinct order_id order by order_id)
  into v_order_ids
  from unnest(p_order_ids) as selected(order_id);

  if v_order_ids is null or array_length(v_order_ids, 1) is null then
    raise exception 'no_orders';
  end if;

  select count(*) into v_matched_count
  from public.community_orders o
  where o.id = any(v_order_ids)
    and lower(trim(o.nickname)) = lower(v_nickname);

  if v_matched_count <> array_length(v_order_ids, 1) then
    raise exception 'order_nickname_mismatch';
  end if;

  lock table public.community_shipment_requests in share row exclusive mode;

  if exists (
    select 1
    from public.community_shipment_requests s
    where s.status <> 'cancelled'
      and s.order_ids && v_order_ids
  ) then
    raise exception 'shipment_already_requested';
  end if;

  select count(*) into v_unpaid_count
  from public.community_orders o
  where o.id = any(v_order_ids)
    and o.payment_status <> 'paid';

  if v_unpaid_count > 0 then
    raise exception 'not_all_paid';
  end if;

  select count(*) into v_empty_count
  from public.community_orders o
  where o.id = any(v_order_ids)
    and not exists (
      select 1 from public.community_order_items i
      where i.order_id = o.id and i.purchase_status = 'bought'
    );

  if v_empty_count > 0 then
    raise exception 'no_bought_items';
  end if;

  select count(*) into v_not_arrived_count
  from public.community_order_items i
  where i.order_id = any(v_order_ids)
    and i.purchase_status = 'bought'
    and i.arrival_status <> 'arrived';

  if v_not_arrived_count > 0 then
    raise exception 'not_all_arrived';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'orderId', o.id,
    'notebookName', o.notebook_name,
    'amount', coalesce((
      select sum(i.subtotal) filter (where i.purchase_status = 'bought')
      from public.community_order_items i
      where i.order_id = o.id
    ), 0),
    'paymentStatus', o.payment_status::text,
    'arrivalStatus', 'arrived',
    'boughtItemCount', (
      select count(*) from public.community_order_items i
      where i.order_id = o.id and i.purchase_status = 'bought'
    )
  ) order by o.notebook_name), '[]'::jsonb)
  into v_snapshot
  from public.community_orders o
  where o.id = any(v_order_ids);

  insert into public.community_shipment_requests (
    nickname,
    order_ids,
    recipient_name,
    phone,
    pickup_store,
    shipping_method,
    notebook_snapshot
  ) values (
    v_nickname,
    v_order_ids,
    v_recipient,
    v_phone,
    v_store,
    'seven_eleven',
    v_snapshot
  )
  returning id, submitted_at into v_id, v_submitted_at;

  return jsonb_build_object(
    'id', v_id,
    'submittedAt', v_submitted_at,
    'status', 'pending',
    'shippingMethod', 'seven_eleven',
    'notebookSnapshot', v_snapshot
  );
end;
$$;

drop function if exists public.backend_list_community_shipment_requests(text, integer, integer);

create function public.backend_list_community_shipment_requests(
  p_q text default '',
  p_page integer default 1,
  p_page_size integer default 50
)
returns table (
  total_count bigint,
  id uuid,
  nickname text,
  notebook_names text[],
  notebook_snapshot jsonb,
  items jsonb,
  recipient_name text,
  phone text,
  pickup_store text,
  shipping_method text,
  marketplace_url text,
  marketplace_order_ref text,
  status text,
  submitted_at timestamptz,
  accepted_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz
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
        select 1 from jsonb_array_elements(s.notebook_snapshot) n
        where n->>'notebookName' ilike '%' || trim(p_q) || '%'
      )
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
    coalesce(
      (select array_agg(n->>'notebookName' order by n->>'notebookName') from jsonb_array_elements(p.notebook_snapshot) n),
      (select array_agg(o.notebook_name order by o.notebook_name) from public.community_orders o where o.id = any(p.order_ids))
    ) as notebook_names,
    p.notebook_snapshot,
    (
      select coalesce(jsonb_agg(jsonb_build_object(
        'productName', i.product_name,
        'variantSpec', i.variant_spec,
        'quantity', i.quantity
      ) order by i.created_at), '[]'::jsonb)
      from public.community_order_items i
      where i.order_id = any(p.order_ids)
        and i.purchase_status = 'bought'
    ) as items,
    p.recipient_name,
    p.phone,
    p.pickup_store,
    p.shipping_method,
    p.marketplace_url,
    p.marketplace_order_ref,
    p.status,
    p.submitted_at,
    p.accepted_at,
    p.completed_at,
    p.cancelled_at
  from paged p
  order by p.submitted_at desc, p.id desc;
$$;

create function public.backend_update_community_shipment_status(
  p_id uuid,
  p_status text,
  p_marketplace_url text default null,
  p_marketplace_order_ref text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.community_shipment_requests%rowtype;
  v_url text := nullif(trim(coalesce(p_marketplace_url, '')), '');
  v_ref text := nullif(trim(coalesce(p_marketplace_order_ref, '')), '');
begin
  if p_status not in ('pending', 'accepted', 'completed', 'cancelled') then
    raise exception 'invalid_status';
  end if;

  select * into v_request
  from public.community_shipment_requests
  where id = p_id
  for update;

  if v_request.id is null then
    raise exception 'request_not_found';
  end if;

  if v_request.status = 'cancelled' and p_status <> 'cancelled' then
    raise exception 'cancelled_request_is_final';
  end if;
  if v_request.status = 'completed' and p_status <> 'completed' then
    raise exception 'completed_request_is_final';
  end if;

  update public.community_shipment_requests
  set status = p_status,
      marketplace_url = coalesce(v_url, marketplace_url),
      marketplace_order_ref = coalesce(v_ref, marketplace_order_ref),
      accepted_at = case when p_status = 'accepted' then coalesce(accepted_at, now()) else accepted_at end,
      completed_at = case when p_status = 'completed' then coalesce(completed_at, now()) else completed_at end,
      cancelled_at = case when p_status = 'cancelled' then coalesce(cancelled_at, now()) else cancelled_at end
  where id = p_id;

  return jsonb_build_object(
    'id', p_id,
    'status', p_status,
    'marketplaceUrl', coalesce(v_url, v_request.marketplace_url),
    'marketplaceOrderRef', coalesce(v_ref, v_request.marketplace_order_ref)
  );
end;
$$;

revoke all on function public.submit_community_shipment_request(text, uuid[], text, text, text) from public;
revoke all on function public.backend_list_community_shipment_requests(text, integer, integer) from public;
revoke all on function public.backend_update_community_shipment_status(uuid, text, text, text) from public;

grant execute on function public.submit_community_shipment_request(text, uuid[], text, text, text) to service_role;
grant execute on function public.backend_list_community_shipment_requests(text, integer, integer) to service_role;
grant execute on function public.backend_update_community_shipment_status(uuid, text, text, text) to service_role;
