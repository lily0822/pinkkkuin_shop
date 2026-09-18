create or replace function public.backend_list_community_orders(
  p_q text default '',
  p_page integer default 1,
  p_page_size integer default 50
)
returns table (
  total_count bigint,
  order_id uuid,
  notebook_name text,
  nickname text,
  payment_status text,
  arrival_status text,
  order_stage text,
  notes text,
  order_created_at timestamptz,
  item_id uuid,
  product_name text,
  quantity integer,
  unit_price numeric,
  item_subtotal numeric,
  snipe_status text,
  item_created_at timestamptz,
  group_total numeric,
  remit_amount numeric,
  group_first boolean
)
language sql
security definer
set search_path = public
as $$
  with matched_orders as (
    select o.id
    from public.community_orders o
    where nullif(trim(coalesce(p_q, '')), '') is null
      or o.nickname ilike '%' || trim(p_q) || '%'
      or o.notebook_name ilike '%' || trim(p_q) || '%'
      or exists (
        select 1 from public.community_order_items i2
        where i2.order_id = o.id and i2.product_name ilike '%' || trim(p_q) || '%'
      )
  ),
  paged_orders as (
    select o.*, count(*) over()::bigint as total_count
    from public.community_orders o
    join matched_orders m on m.id = o.id
    order by o.created_at desc, o.id desc
    limit least(greatest(coalesce(p_page_size, 50), 1), 200)
    offset (greatest(coalesce(p_page, 1), 1) - 1) * least(greatest(coalesce(p_page_size, 50), 1), 200)
  ),
  group_totals as (
    select i.order_id, coalesce(sum(i.subtotal), 0)::numeric as group_total
    from public.community_order_items i
    join paged_orders po on po.id = i.order_id
    group by i.order_id
  ),
  ranked_items as (
    select
      i.*,
      row_number() over (partition by i.order_id order by i.created_at asc, i.id asc) as rn
    from public.community_order_items i
    join paged_orders po on po.id = i.order_id
  )
  select
    po.total_count,
    po.id as order_id,
    po.notebook_name,
    po.nickname,
    po.payment_status::text,
    po.arrival_status::text,
    po.order_stage::text,
    po.notes,
    po.created_at as order_created_at,
    ri.id as item_id,
    ri.product_name,
    ri.quantity,
    ri.unit_price,
    ri.subtotal as item_subtotal,
    ri.snipe_status::text,
    ri.created_at as item_created_at,
    coalesce(gt.group_total, 0) as group_total,
    coalesce(gt.group_total, 0) - 20 as remit_amount,
    (ri.rn = 1) as group_first
  from paged_orders po
  join ranked_items ri on ri.order_id = po.id
  left join group_totals gt on gt.order_id = po.id
  order by po.created_at desc, po.id desc, ri.rn asc;
$$;

create or replace function public.lookup_community_orders_by_nickname(p_nickname text)
returns table (
  order_id uuid,
  notebook_name text,
  nickname text,
  payment_status text,
  arrival_status text,
  order_stage text,
  order_created_at timestamptz,
  item_id uuid,
  product_name text,
  quantity integer,
  unit_price numeric,
  item_subtotal numeric,
  snipe_status text,
  group_total numeric,
  remit_amount numeric,
  group_first boolean
)
language sql
security definer
set search_path = public
as $$
  with matched_orders as (
    select o.*
    from public.community_orders o
    where nullif(trim(coalesce(p_nickname, '')), '') is not null
      and lower(trim(o.nickname)) = lower(trim(p_nickname))
  ),
  group_totals as (
    select i.order_id, coalesce(sum(i.subtotal), 0)::numeric as group_total
    from public.community_order_items i
    join matched_orders mo on mo.id = i.order_id
    group by i.order_id
  ),
  ranked_items as (
    select
      i.*,
      row_number() over (partition by i.order_id order by i.created_at asc, i.id asc) as rn
    from public.community_order_items i
    join matched_orders mo on mo.id = i.order_id
  )
  select
    mo.id as order_id,
    mo.notebook_name,
    mo.nickname,
    mo.payment_status::text,
    mo.arrival_status::text,
    mo.order_stage::text,
    mo.created_at as order_created_at,
    ri.id as item_id,
    ri.product_name,
    ri.quantity,
    ri.unit_price,
    ri.subtotal as item_subtotal,
    ri.snipe_status::text,
    coalesce(gt.group_total, 0) as group_total,
    coalesce(gt.group_total, 0) - 20 as remit_amount,
    (ri.rn = 1) as group_first
  from matched_orders mo
  join ranked_items ri on ri.order_id = mo.id
  left join group_totals gt on gt.order_id = mo.id
  order by mo.created_at desc, mo.id desc, ri.rn asc;
$$;

create or replace function public.backend_import_community_orders(
  p_source_filename text,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch_id uuid;
  v_row jsonb;
  v_order_id uuid;
  v_notebook text;
  v_nickname text;
  v_product text;
  v_qty integer;
  v_price numeric;
  v_row_count integer := 0;
  v_item_count integer := 0;
  v_order_ids uuid[] := '{}';
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'no_rows';
  end if;

  insert into public.community_import_batches (source_filename, row_count)
  values (nullif(trim(coalesce(p_source_filename, '')), ''), jsonb_array_length(p_rows))
  returning id into v_batch_id;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_notebook := nullif(trim(coalesce(v_row->>'notebook_name', '')), '');
    v_nickname := nullif(trim(coalesce(v_row->>'nickname', '')), '');
    v_product := nullif(trim(coalesce(v_row->>'product_name', '')), '');
    v_qty := greatest(coalesce((v_row->>'quantity')::integer, 1), 1);
    v_price := greatest(coalesce((v_row->>'unit_price')::numeric, 0), 0);

    if v_notebook is null or v_nickname is null or v_product is null then
      continue;
    end if;

    insert into public.community_orders as o (notebook_name, nickname)
    values (v_notebook, v_nickname)
    on conflict (notebook_name, nickname) do update set updated_at = now()
    returning o.id into v_order_id;

    insert into public.community_order_items (order_id, import_batch_id, product_name, quantity, unit_price)
    values (v_order_id, v_batch_id, v_product, v_qty, v_price);

    v_row_count := v_row_count + 1;
    v_item_count := v_item_count + 1;
    if not (v_order_id = any(v_order_ids)) then
      v_order_ids := array_append(v_order_ids, v_order_id);
    end if;
  end loop;

  if v_row_count = 0 then
    delete from public.community_import_batches where id = v_batch_id;
    raise exception 'no_valid_rows';
  end if;

  update public.community_import_batches
  set row_count = v_row_count,
      item_count = v_item_count,
      order_count = coalesce(array_length(v_order_ids, 1), 0)
  where id = v_batch_id;

  return jsonb_build_object(
    'batchId', v_batch_id,
    'rowCount', v_row_count,
    'itemCount', v_item_count,
    'orderCount', coalesce(array_length(v_order_ids, 1), 0)
  );
end;
$$;

create or replace function public.backend_update_community_order(
  p_order_id uuid,
  p_payment_status text default null,
  p_arrival_status text default null,
  p_order_stage text default null,
  p_notes text default null,
  p_notes_set boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.community_orders
  set
    payment_status = coalesce(p_payment_status::community_payment_status, payment_status),
    arrival_status = coalesce(p_arrival_status::community_arrival_status, arrival_status),
    order_stage = coalesce(p_order_stage::community_order_stage, order_stage),
    notes = case when p_notes_set then p_notes else notes end
  where id = p_order_id;
end;
$$;

create or replace function public.backend_update_community_order_item(
  p_item_id uuid,
  p_snipe_status text
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.community_order_items
  set snipe_status = p_snipe_status::community_snipe_status
  where id = p_item_id;
$$;

revoke all on function public.backend_list_community_orders(text, integer, integer) from public;
revoke all on function public.lookup_community_orders_by_nickname(text) from public;
revoke all on function public.backend_import_community_orders(text, jsonb) from public;
revoke all on function public.backend_update_community_order(uuid, text, text, text, text, boolean) from public;
revoke all on function public.backend_update_community_order_item(uuid, text) from public;

grant execute on function public.backend_list_community_orders(text, integer, integer) to service_role;
grant execute on function public.lookup_community_orders_by_nickname(text) to service_role;
grant execute on function public.backend_import_community_orders(text, jsonb) to service_role;
grant execute on function public.backend_update_community_order(uuid, text, text, text, text, boolean) to service_role;
grant execute on function public.backend_update_community_order_item(uuid, text) to service_role;
