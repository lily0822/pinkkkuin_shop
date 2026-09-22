do $$ begin
  create type public.community_purchase_status as enum ('bought', 'not_bought');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.community_item_arrival_status as enum ('not_arrived', 'arrived', 'exception');
exception
  when duplicate_object then null;
end $$;

alter table public.community_order_items
  add column if not exists purchase_status public.community_purchase_status not null default 'bought',
  add column if not exists arrival_status public.community_item_arrival_status not null default 'not_arrived';

create index if not exists community_order_items_purchase_status_idx
  on public.community_order_items (purchase_status);

create index if not exists community_order_items_arrival_status_idx
  on public.community_order_items (arrival_status);

create or replace function public.backend_list_community_notebooks()
returns table (
  notebook_name text,
  customer_count bigint,
  item_count bigint,
  bought_quantity bigint,
  not_bought_quantity bigint,
  arrived_bought_quantity bigint,
  not_arrived_bought_quantity bigint,
  exception_bought_quantity bigint
)
language sql
security definer
set search_path = public
as $$
  select
    o.notebook_name,
    count(distinct lower(trim(o.nickname)))::bigint as customer_count,
    count(i.id)::bigint as item_count,
    coalesce(sum(i.quantity) filter (where i.purchase_status = 'bought'), 0)::bigint as bought_quantity,
    coalesce(sum(i.quantity) filter (where i.purchase_status = 'not_bought'), 0)::bigint as not_bought_quantity,
    coalesce(sum(i.quantity) filter (
      where i.purchase_status = 'bought' and i.arrival_status = 'arrived'
    ), 0)::bigint as arrived_bought_quantity,
    coalesce(sum(i.quantity) filter (
      where i.purchase_status = 'bought' and i.arrival_status = 'not_arrived'
    ), 0)::bigint as not_arrived_bought_quantity,
    coalesce(sum(i.quantity) filter (
      where i.purchase_status = 'bought' and i.arrival_status = 'exception'
    ), 0)::bigint as exception_bought_quantity
  from public.community_orders o
  left join public.community_order_items i on i.order_id = o.id
  group by o.notebook_name
  order by max(o.created_at) desc, o.notebook_name;
$$;

create or replace function public.backend_mark_community_notebook_arrived(p_notebook_name text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated_count integer;
begin
  if nullif(trim(coalesce(p_notebook_name, '')), '') is null then
    raise exception 'invalid_notebook_name';
  end if;

  update public.community_order_items i
  set arrival_status = 'arrived'::public.community_item_arrival_status
  from public.community_orders o
  where i.order_id = o.id
    and o.notebook_name = trim(p_notebook_name)
    and i.purchase_status = 'bought'::public.community_purchase_status
    and i.arrival_status <> 'arrived'::public.community_item_arrival_status;

  get diagnostics v_updated_count = row_count;
  return v_updated_count;
end;
$$;

revoke all on function public.backend_list_community_notebooks() from public;
revoke all on function public.backend_mark_community_notebook_arrived(text) from public;
grant execute on function public.backend_list_community_notebooks() to service_role;
grant execute on function public.backend_mark_community_notebook_arrived(text) to service_role;
