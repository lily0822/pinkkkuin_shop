create table if not exists public.community_meetup_slots (
  id uuid primary key default gen_random_uuid(),
  meetup_date date not null,
  start_time time not null,
  end_time time not null,
  location text not null check (nullif(trim(location), '') is not null),
  is_open boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_time > start_time)
);

create table if not exists public.community_meetup_requests (
  id uuid primary key default gen_random_uuid(),
  nickname text not null,
  order_ids uuid[] not null check (array_length(order_ids, 1) > 0),
  slot_id uuid not null references public.community_meetup_slots(id) on delete restrict,
  payment_method text not null check (payment_method in ('prepaid', 'pay_at_meetup')),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'completed', 'cancelled')),
  notebook_snapshot jsonb not null default '[]'::jsonb,
  submitted_at timestamptz not null default now(),
  confirmed_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.community_remittance_submissions
  add column if not exists meetup_request_id uuid references public.community_meetup_requests(id) on delete restrict;

create index if not exists community_meetup_slots_date_idx
  on public.community_meetup_slots (meetup_date, start_time);
create index if not exists community_meetup_requests_nickname_idx
  on public.community_meetup_requests (lower(nickname), submitted_at desc);
create index if not exists community_meetup_requests_active_orders_idx
  on public.community_meetup_requests using gin (order_ids)
  where status <> 'cancelled';
create index if not exists community_remittance_submissions_meetup_idx
  on public.community_remittance_submissions (meetup_request_id)
  where meetup_request_id is not null;

drop trigger if exists community_meetup_slots_set_updated_at on public.community_meetup_slots;
create trigger community_meetup_slots_set_updated_at
before update on public.community_meetup_slots
for each row execute function set_updated_at();

drop trigger if exists community_meetup_requests_set_updated_at on public.community_meetup_requests;
create trigger community_meetup_requests_set_updated_at
before update on public.community_meetup_requests
for each row execute function set_updated_at();

alter table public.community_meetup_slots enable row level security;
alter table public.community_meetup_requests enable row level security;
revoke all on public.community_meetup_slots from anon, authenticated;
revoke all on public.community_meetup_requests from anon, authenticated;
revoke all on public.community_meetup_slots from service_role;
revoke all on public.community_meetup_requests from service_role;
grant select, insert, update on public.community_meetup_slots to service_role;
grant select on public.community_meetup_requests to service_role;

create or replace function public.guard_community_fulfillment_lock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
begin
  foreach v_order_id in array (
    select array_agg(distinct id order by id)
    from unnest(new.order_ids) selected(id)
  ) loop
    perform pg_advisory_xact_lock(hashtextextended(v_order_id::text, 20260922));
  end loop;

  if exists (
    select 1 from public.community_shipment_requests s
    where s.status <> 'cancelled' and s.order_ids && new.order_ids
  ) or exists (
    select 1 from public.community_meetup_requests m
    where m.status <> 'cancelled' and m.order_ids && new.order_ids
  ) then
    raise exception 'fulfillment_already_requested';
  end if;
  return new;
end;
$$;

drop trigger if exists community_shipment_requests_fulfillment_lock on public.community_shipment_requests;
create trigger community_shipment_requests_fulfillment_lock
before insert on public.community_shipment_requests
for each row execute function public.guard_community_fulfillment_lock();

drop trigger if exists community_meetup_requests_fulfillment_lock on public.community_meetup_requests;
create trigger community_meetup_requests_fulfillment_lock
before insert on public.community_meetup_requests
for each row execute function public.guard_community_fulfillment_lock();

create or replace function public.submit_community_meetup_request(
  p_nickname text,
  p_order_ids uuid[],
  p_slot_id uuid,
  p_payment_method text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nickname text := nullif(trim(coalesce(p_nickname, '')), '');
  v_order_ids uuid[];
  v_slot public.community_meetup_slots%rowtype;
  v_matched integer;
  v_empty integer;
  v_not_arrived integer;
  v_snapshot jsonb;
  v_id uuid;
  v_submitted_at timestamptz;
begin
  if v_nickname is null or p_slot_id is null or p_payment_method not in ('prepaid', 'pay_at_meetup') then
    raise exception 'invalid_input';
  end if;
  select array_agg(distinct id order by id) into v_order_ids from unnest(p_order_ids) selected(id);
  if v_order_ids is null or array_length(v_order_ids, 1) is null then raise exception 'no_orders'; end if;

  select * into v_slot from public.community_meetup_slots where id = p_slot_id for update;
  if v_slot.id is null then raise exception 'slot_not_found'; end if;
  if not v_slot.is_open then raise exception 'slot_closed'; end if;
  if ((v_slot.meetup_date + v_slot.end_time) at time zone 'Asia/Taipei') <= now() then
    raise exception 'slot_expired';
  end if;

  select count(*) into v_matched from public.community_orders o
  where o.id = any(v_order_ids) and lower(trim(o.nickname)) = lower(v_nickname);
  if v_matched <> array_length(v_order_ids, 1) then raise exception 'order_nickname_mismatch'; end if;

  select count(*) into v_empty from public.community_orders o
  where o.id = any(v_order_ids) and not exists (
    select 1 from public.community_order_items i where i.order_id = o.id and i.purchase_status = 'bought'
  );
  if v_empty > 0 then raise exception 'no_bought_items'; end if;

  select count(*) into v_not_arrived from public.community_order_items i
  where i.order_id = any(v_order_ids) and i.purchase_status = 'bought' and i.arrival_status <> 'arrived';
  if v_not_arrived > 0 then raise exception 'not_all_arrived'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'orderId', o.id,
    'notebookName', o.notebook_name,
    'amount', coalesce((select sum(i.subtotal) filter (where i.purchase_status = 'bought') from public.community_order_items i where i.order_id = o.id), 0),
    'paymentStatus', o.payment_status::text,
    'arrivalStatus', 'arrived'
  ) order by o.notebook_name), '[]'::jsonb)
  into v_snapshot from public.community_orders o where o.id = any(v_order_ids);

  insert into public.community_meetup_requests (nickname, order_ids, slot_id, payment_method, notebook_snapshot)
  values (v_nickname, v_order_ids, p_slot_id, p_payment_method, v_snapshot)
  returning id, submitted_at into v_id, v_submitted_at;

  return jsonb_build_object('id', v_id, 'status', 'pending', 'submittedAt', v_submitted_at);
end;
$$;

create or replace function public.backend_list_community_meetup_requests(p_limit integer default 100)
returns table (
  id uuid,
  nickname text,
  order_ids uuid[],
  notebook_names text[],
  notebook_snapshot jsonb,
  slot_id uuid,
  meetup_date date,
  start_time time,
  end_time time,
  location text,
  payment_method text,
  payment_status text,
  status text,
  submitted_at timestamptz,
  confirmed_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select m.id, m.nickname, m.order_ids,
    coalesce((select array_agg(n->>'notebookName' order by n->>'notebookName') from jsonb_array_elements(m.notebook_snapshot) n), array[]::text[]),
    m.notebook_snapshot, s.id, s.meetup_date, s.start_time, s.end_time, s.location,
    m.payment_method,
    case when not exists (select 1 from public.community_orders o where o.id = any(m.order_ids) and o.payment_status <> 'paid') then 'paid' else 'unpaid' end,
    m.status, m.submitted_at, m.confirmed_at, m.completed_at, m.cancelled_at
  from public.community_meetup_requests m
  join public.community_meetup_slots s on s.id = m.slot_id
  order by m.submitted_at desc, m.id desc
  limit least(greatest(coalesce(p_limit, 100), 1), 300);
$$;

create or replace function public.backend_update_community_meetup_request(p_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.community_meetup_requests%rowtype;
  v_order_id uuid;
  v_expected numeric;
  v_received numeric;
  v_remaining numeric;
begin
  if p_status not in ('pending', 'confirmed', 'completed', 'cancelled') then raise exception 'invalid_status'; end if;
  select * into v_request from public.community_meetup_requests where id = p_id for update;
  if v_request.id is null then raise exception 'request_not_found'; end if;
  if v_request.status in ('completed', 'cancelled') and p_status <> v_request.status then raise exception 'request_is_final'; end if;

  if p_status = 'completed' and v_request.status <> 'completed' then
    if v_request.payment_method = 'prepaid' and exists (
      select 1 from public.community_orders o where o.id = any(v_request.order_ids) and o.payment_status <> 'paid'
    ) then raise exception 'prepaid_not_paid'; end if;

    if v_request.payment_method = 'pay_at_meetup' then
      foreach v_order_id in array v_request.order_ids loop
        select coalesce(sum(i.subtotal) filter (where i.purchase_status = 'bought'), 0)
        into v_expected from public.community_order_items i where i.order_id = v_order_id;
        select coalesce(sum(r.amount), 0) into v_received
        from public.community_remittance_submissions r
        where v_order_id = any(r.order_ids)
          and r.status in ('approved', 'topup_required', 'overpaid_pending_refund', 'refund_completed');
        v_remaining := greatest(v_expected - v_received, 0);
        if v_remaining > 0 then
          insert into public.community_remittance_submissions
            (nickname, order_ids, bank, account_last5, amount, expected_amount, status, reviewed_at, meetup_request_id)
          values
            (v_request.nickname, array[v_order_id], 'meetup', '00000', v_remaining, v_expected, 'approved', now(), v_request.id);
        end if;
        update public.community_orders set payment_status = 'paid'::public.community_payment_status where id = v_order_id;
      end loop;
    end if;
  end if;

  update public.community_meetup_requests
  set status = p_status,
      confirmed_at = case when p_status = 'confirmed' then coalesce(confirmed_at, now()) else confirmed_at end,
      completed_at = case when p_status = 'completed' then coalesce(completed_at, now()) else completed_at end,
      cancelled_at = case when p_status = 'cancelled' then coalesce(cancelled_at, now()) else cancelled_at end
  where id = p_id;

  return jsonb_build_object('id', p_id, 'status', p_status, 'updatedAt', now());
end;
$$;

revoke all on function public.guard_community_fulfillment_lock() from public;
revoke all on function public.submit_community_meetup_request(text, uuid[], uuid, text) from public;
revoke all on function public.backend_list_community_meetup_requests(integer) from public;
revoke all on function public.backend_update_community_meetup_request(uuid, text) from public;
grant execute on function public.submit_community_meetup_request(text, uuid[], uuid, text) to service_role;
grant execute on function public.backend_list_community_meetup_requests(integer) to service_role;
grant execute on function public.backend_update_community_meetup_request(uuid, text) to service_role;
