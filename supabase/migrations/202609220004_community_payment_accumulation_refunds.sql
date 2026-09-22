alter table public.community_remittance_submissions
  drop constraint if exists community_remittance_submissions_status_check;

alter table public.community_remittance_submissions
  add column if not exists refunded_at timestamptz,
  add constraint community_remittance_submissions_status_check
  check (status in (
    'pending',
    'approved',
    'rejected',
    'topup_required',
    'overpaid_pending_refund',
    'refund_completed'
  ));

create table if not exists public.community_payment_refunds (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null unique references public.community_remittance_submissions(id) on delete restrict,
  order_id uuid not null,
  amount numeric not null check (amount > 0),
  status text not null default 'completed' check (status in ('completed')),
  completed_at timestamptz not null default now()
);

create index if not exists community_payment_refunds_order_id_idx
  on public.community_payment_refunds (order_id, completed_at desc);

alter table public.community_payment_refunds enable row level security;
revoke all on public.community_payment_refunds from anon;
revoke all on public.community_payment_refunds from authenticated;
revoke all on public.community_payment_refunds from service_role;
grant select on public.community_payment_refunds to service_role;

create or replace function public.submit_community_remittance(
  p_nickname text,
  p_order_ids uuid[],
  p_bank text,
  p_account_last5 text,
  p_amount numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nickname text := nullif(trim(coalesce(p_nickname, '')), '');
  v_bank text := nullif(trim(coalesce(p_bank, '')), '');
  v_last5 text := nullif(trim(coalesce(p_account_last5, '')), '');
  v_amount numeric := coalesce(p_amount, 0);
  v_order_id uuid;
  v_expected numeric;
  v_received numeric;
  v_id uuid;
  v_submitted_at timestamptz;
begin
  if v_nickname is null or v_bank is null or v_last5 is null then
    raise exception 'invalid_input';
  end if;
  if v_bank not in ('ctbc', 'cathay', 'fubon') then
    raise exception 'invalid_bank';
  end if;
  if v_last5 !~ '^[0-9]{5}$' then
    raise exception 'invalid_last5';
  end if;
  if p_order_ids is null or array_length(p_order_ids, 1) <> 1 then
    raise exception 'single_notebook_required';
  end if;
  if v_amount <= 0 then
    raise exception 'invalid_amount';
  end if;

  select o.id into v_order_id
  from public.community_orders o
  where o.id = p_order_ids[1]
    and lower(trim(o.nickname)) = lower(v_nickname)
  for update;

  if v_order_id is null then
    raise exception 'order_nickname_mismatch';
  end if;

  if exists (
    select 1
    from public.community_remittance_submissions s
    where v_order_id = any(s.order_ids)
      and s.status = 'pending'
  ) then
    raise exception 'payment_pending_review';
  end if;

  select coalesce(sum(i.subtotal) filter (where i.purchase_status = 'bought'), 0)
  into v_expected
  from public.community_order_items i
  where i.order_id = v_order_id;

  if coalesce(v_expected, 0) <= 0 then
    raise exception 'no_payable_items';
  end if;

  select coalesce(sum(s.amount), 0)
  into v_received
  from public.community_remittance_submissions s
  where v_order_id = any(s.order_ids)
    and s.status in ('approved', 'topup_required', 'overpaid_pending_refund', 'refund_completed');

  if v_received >= v_expected then
    raise exception 'payment_already_complete';
  end if;

  insert into public.community_remittance_submissions
    (nickname, order_ids, bank, account_last5, amount, expected_amount, status)
  values
    (v_nickname, array[v_order_id], v_bank, v_last5, v_amount, v_expected, 'pending')
  returning id, submitted_at into v_id, v_submitted_at;

  return jsonb_build_object(
    'id', v_id,
    'submittedAt', v_submitted_at,
    'expectedAmount', v_expected,
    'cumulativeReceived', v_received,
    'remainingAmount', greatest(v_expected - v_received, 0),
    'status', 'pending'
  );
end;
$$;

drop function if exists public.backend_list_community_remittances(integer);

create function public.backend_list_community_remittances(p_limit integer default 100)
returns table (
  id uuid,
  order_id uuid,
  nickname text,
  notebook_names text[],
  bank text,
  account_last5 text,
  amount numeric,
  expected_amount numeric,
  cumulative_received numeric,
  remaining_amount numeric,
  overpaid_amount numeric,
  submitted_at timestamptz,
  status text,
  rejection_reason text,
  reviewed_at timestamptz,
  refunded_at timestamptz,
  refund_amount numeric,
  refund_completed_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    s.id,
    s.order_ids[1] as order_id,
    s.nickname,
    (
      select array_agg(o.notebook_name order by o.notebook_name)
      from public.community_orders o
      where o.id = any(s.order_ids)
    ) as notebook_names,
    s.bank,
    s.account_last5,
    s.amount,
    totals.expected_amount,
    totals.cumulative_received,
    greatest(totals.expected_amount - totals.cumulative_received, 0) as remaining_amount,
    greatest(totals.cumulative_received - totals.expected_amount, 0) as overpaid_amount,
    s.submitted_at,
    s.status,
    s.rejection_reason,
    s.reviewed_at,
    s.refunded_at,
    coalesce(r.amount, 0) as refund_amount,
    r.completed_at as refund_completed_at
  from public.community_remittance_submissions s
  cross join lateral (
    select
      coalesce((
        select sum(i.subtotal) filter (where i.purchase_status = 'bought')
        from public.community_order_items i
        where i.order_id = s.order_ids[1]
      ), s.expected_amount, 0) as expected_amount,
      coalesce((
        select sum(p.amount)
        from public.community_remittance_submissions p
        where s.order_ids[1] = any(p.order_ids)
          and p.status in ('approved', 'topup_required', 'overpaid_pending_refund', 'refund_completed')
      ), 0) as cumulative_received
  ) totals
  left join public.community_payment_refunds r on r.submission_id = s.id
  order by s.submitted_at desc, s.id desc
  limit least(greatest(coalesce(p_limit, 100), 1), 300);
$$;

create or replace function public.backend_review_community_remittance(
  p_submission_id uuid,
  p_decision text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_submission public.community_remittance_submissions%rowtype;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_order_id uuid;
  v_expected numeric;
  v_prior_received numeric;
  v_cumulative numeric;
  v_status text;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'invalid_decision';
  end if;
  if p_decision = 'rejected' and v_reason is null then
    raise exception 'rejection_reason_required';
  end if;

  select * into v_submission
  from public.community_remittance_submissions
  where id = p_submission_id
  for update;

  if v_submission.id is null then
    raise exception 'submission_not_found';
  end if;
  if v_submission.status <> 'pending' then
    raise exception 'submission_already_reviewed';
  end if;

  v_order_id := v_submission.order_ids[1];

  select coalesce(sum(i.subtotal) filter (where i.purchase_status = 'bought'), 0)
  into v_expected
  from public.community_order_items i
  where i.order_id = v_order_id;

  select coalesce(sum(s.amount), 0)
  into v_prior_received
  from public.community_remittance_submissions s
  where v_order_id = any(s.order_ids)
    and s.id <> p_submission_id
    and s.status in ('approved', 'topup_required', 'overpaid_pending_refund', 'refund_completed');

  if p_decision = 'rejected' then
    v_status := 'rejected';
    v_cumulative := v_prior_received;
  else
    v_cumulative := v_prior_received + v_submission.amount;
    v_status := case
      when v_cumulative < v_expected then 'topup_required'
      when v_cumulative > v_expected then 'overpaid_pending_refund'
      else 'approved'
    end;
  end if;

  update public.community_remittance_submissions
  set status = v_status,
      rejection_reason = case when v_status = 'rejected' then v_reason else null end,
      reviewed_at = now()
  where id = p_submission_id;

  update public.community_orders
  set payment_status = case
    when v_cumulative >= v_expected and v_expected > 0 then 'paid'::public.community_payment_status
    else 'unpaid'::public.community_payment_status
  end
  where id = v_order_id;

  return jsonb_build_object(
    'id', p_submission_id,
    'status', v_status,
    'expectedAmount', v_expected,
    'cumulativeReceived', v_cumulative,
    'remainingAmount', greatest(v_expected - v_cumulative, 0),
    'overpaidAmount', greatest(v_cumulative - v_expected, 0),
    'reviewedAt', now()
  );
end;
$$;

create or replace function public.backend_complete_community_refund(p_submission_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_submission public.community_remittance_submissions%rowtype;
  v_order_id uuid;
  v_expected numeric;
  v_received numeric;
  v_refund numeric;
  v_refund_id uuid;
  v_completed_at timestamptz;
begin
  select * into v_submission
  from public.community_remittance_submissions
  where id = p_submission_id
  for update;

  if v_submission.id is null then
    raise exception 'submission_not_found';
  end if;
  if v_submission.status <> 'overpaid_pending_refund' then
    raise exception 'refund_not_pending';
  end if;

  v_order_id := v_submission.order_ids[1];

  select coalesce(sum(i.subtotal) filter (where i.purchase_status = 'bought'), 0)
  into v_expected
  from public.community_order_items i
  where i.order_id = v_order_id;

  select coalesce(sum(s.amount), 0)
  into v_received
  from public.community_remittance_submissions s
  where v_order_id = any(s.order_ids)
    and s.status in ('approved', 'topup_required', 'overpaid_pending_refund', 'refund_completed');

  v_refund := greatest(v_received - v_expected, 0);
  if v_refund <= 0 then
    raise exception 'no_refund_due';
  end if;

  insert into public.community_payment_refunds (submission_id, order_id, amount)
  values (p_submission_id, v_order_id, v_refund)
  returning id, completed_at into v_refund_id, v_completed_at;

  update public.community_remittance_submissions
  set status = 'refund_completed',
      refunded_at = v_completed_at
  where id = p_submission_id;

  return jsonb_build_object(
    'id', v_refund_id,
    'submissionId', p_submission_id,
    'status', 'refund_completed',
    'refundAmount', v_refund,
    'completedAt', v_completed_at
  );
end;
$$;

revoke all on function public.submit_community_remittance(text, uuid[], text, text, numeric) from public;
revoke all on function public.backend_list_community_remittances(integer) from public;
revoke all on function public.backend_review_community_remittance(uuid, text, text) from public;
revoke all on function public.backend_complete_community_refund(uuid) from public;

grant execute on function public.submit_community_remittance(text, uuid[], text, text, numeric) to service_role;
grant execute on function public.backend_list_community_remittances(integer) to service_role;
grant execute on function public.backend_review_community_remittance(uuid, text, text) to service_role;
grant execute on function public.backend_complete_community_refund(uuid) to service_role;
