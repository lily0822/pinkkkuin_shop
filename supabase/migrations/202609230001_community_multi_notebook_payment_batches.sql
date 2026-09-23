alter table public.community_remittance_submissions
  add column if not exists batch_key uuid;

update public.community_remittance_submissions
set batch_key = id
where batch_key is null;

-- Existing single-notebook top-ups belong to one historical payment batch.
update public.community_remittance_submissions s
set batch_key = (
  select first_payment.id
  from public.community_remittance_submissions first_payment
  where array_length(first_payment.order_ids, 1) = 1
    and first_payment.order_ids[1] = s.order_ids[1]
  order by first_payment.submitted_at, first_payment.id
  limit 1
)
where array_length(s.order_ids, 1) = 1;

alter table public.community_remittance_submissions
  alter column batch_key set default gen_random_uuid(),
  alter column batch_key set not null;

create index if not exists community_remittance_submissions_batch_key_idx
  on public.community_remittance_submissions (batch_key, submitted_at, id);

create table if not exists public.community_remittance_submission_orders (
  submission_id uuid not null references public.community_remittance_submissions(id) on delete cascade,
  order_id uuid not null,
  notebook_name text not null,
  product_total numeric(12, 2) not null check (product_total >= 0),
  discount_amount numeric(12, 2) not null check (discount_amount >= 0),
  payable_amount numeric(12, 2) not null check (payable_amount >= 0),
  created_at timestamptz not null default now(),
  primary key (submission_id, order_id),
  constraint community_remittance_submission_orders_math_check
    check (payable_amount = greatest(product_total - discount_amount, 0))
);

create index if not exists community_remittance_submission_orders_order_id_idx
  on public.community_remittance_submission_orders (order_id, submission_id);

alter table public.community_remittance_submission_orders enable row level security;
revoke all on public.community_remittance_submission_orders from anon;
revoke all on public.community_remittance_submission_orders from authenticated;
revoke all on public.community_remittance_submission_orders from service_role;
grant select, insert on public.community_remittance_submission_orders to service_role;

-- Existing submissions keep their historical expected amount and receive no retroactive discount.
insert into public.community_remittance_submission_orders
  (submission_id, order_id, notebook_name, product_total, discount_amount, payable_amount)
select
  s.id,
  o.id,
  o.notebook_name,
  case when array_length(s.order_ids, 1) = 1 then greatest(s.expected_amount, 0)
    else greatest(coalesce((select sum(i.subtotal) filter (where i.purchase_status = 'bought')
      from public.community_order_items i where i.order_id = o.id), 0), 0) end,
  case when array_length(s.order_ids, 1) = 1 then 0
    else least(20, greatest(coalesce((select sum(i.subtotal) filter (where i.purchase_status = 'bought')
      from public.community_order_items i where i.order_id = o.id), 0), 0)) end,
  case when array_length(s.order_ids, 1) = 1 then greatest(s.expected_amount, 0)
    else greatest(greatest(coalesce((select sum(i.subtotal) filter (where i.purchase_status = 'bought')
      from public.community_order_items i where i.order_id = o.id), 0), 0) - 20, 0) end
from public.community_remittance_submissions s
join public.community_orders o on o.id = any(s.order_ids)
where not exists (
  select 1
  from public.community_remittance_submission_orders d
  where d.submission_id = s.id and d.order_id = o.id
)
on conflict (submission_id, order_id) do nothing;

alter table public.community_payment_refunds
  add column if not exists batch_key uuid;

update public.community_payment_refunds r
set batch_key = s.batch_key
from public.community_remittance_submissions s
where s.id = r.submission_id and r.batch_key is null;

create index if not exists community_payment_refunds_batch_key_idx
  on public.community_payment_refunds (batch_key, completed_at desc);

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
  v_order_ids uuid[];
  v_existing_batch uuid;
  v_existing_order_ids uuid[];
  v_batch_key uuid;
  v_expected numeric;
  v_product_total numeric;
  v_discount_total numeric;
  v_received numeric;
  v_id uuid;
  v_submitted_at timestamptz;
begin
  if v_nickname is null or v_bank is null or v_last5 is null then raise exception 'invalid_input'; end if;
  if v_bank not in ('ctbc', 'cathay', 'fubon') then raise exception 'invalid_bank'; end if;
  if v_last5 !~ '^[0-9]{5}$' then raise exception 'invalid_last5'; end if;
  if v_amount <= 0 then raise exception 'invalid_amount'; end if;

  select array_agg(distinct id order by id) into v_order_ids
  from unnest(p_order_ids) selected(id)
  where id is not null;
  if v_order_ids is null or array_length(v_order_ids, 1) is null then raise exception 'no_orders'; end if;

  perform 1
  from public.community_orders o
  where o.id = any(v_order_ids)
  order by o.id
  for update;

  if (select count(*) from public.community_orders o where o.id = any(v_order_ids) and lower(trim(o.nickname)) = lower(v_nickname))
     <> array_length(v_order_ids, 1) then
    raise exception 'order_nickname_mismatch';
  end if;

  if exists (
    select 1 from public.community_remittance_submissions s
    where s.order_ids && v_order_ids and s.status = 'pending'
  ) then raise exception 'payment_pending_review'; end if;

  select s.batch_key into v_existing_batch
  from public.community_remittance_submissions s
  where s.order_ids && v_order_ids
    and s.status in ('topup_required', 'rejected')
  order by s.submitted_at desc, s.id desc
  limit 1;

  if v_existing_batch is not null then
    select array_agg(distinct id order by id) into v_existing_order_ids
    from (
      select unnest(s.order_ids) as id
      from public.community_remittance_submissions s
      where s.batch_key = v_existing_batch
    ) batch_orders;
    if v_existing_order_ids is distinct from v_order_ids then raise exception 'batch_orders_must_match'; end if;
    v_batch_key := v_existing_batch;
  else
    if exists (select 1 from public.community_orders o where o.id = any(v_order_ids) and o.payment_status = 'paid') then
      raise exception 'payment_already_complete';
    end if;
    v_batch_key := gen_random_uuid();
  end if;

  if v_existing_batch is null then
    select coalesce(sum(greatest(t.product_total - least(20, t.product_total), 0)), 0),
           coalesce(sum(t.product_total), 0),
           coalesce(sum(least(20, t.product_total)), 0)
    into v_expected, v_product_total, v_discount_total
    from (
      select o.id, coalesce(sum(i.subtotal) filter (where i.purchase_status = 'bought'), 0) as product_total
      from public.community_orders o
      left join public.community_order_items i on i.order_id = o.id
      where o.id = any(v_order_ids)
      group by o.id
    ) t;
  else
    select coalesce(sum(d.payable_amount), 0), coalesce(sum(d.product_total), 0), coalesce(sum(d.discount_amount), 0)
    into v_expected, v_product_total, v_discount_total
    from public.community_remittance_submission_orders d
    where d.submission_id = (
      select s.id from public.community_remittance_submissions s
      where s.batch_key = v_batch_key order by s.submitted_at desc, s.id desc limit 1
    );
  end if;

  if coalesce(v_product_total, 0) <= 0 then raise exception 'no_payable_items'; end if;

  select coalesce(sum(s.amount), 0) into v_received
  from public.community_remittance_submissions s
  where s.batch_key = v_batch_key
    and s.status in ('approved', 'topup_required', 'overpaid_pending_refund', 'refund_completed');
  if v_received >= v_expected then raise exception 'payment_already_complete'; end if;

  insert into public.community_remittance_submissions
    (nickname, order_ids, bank, account_last5, amount, expected_amount, status, batch_key)
  values
    (v_nickname, v_order_ids, v_bank, v_last5, v_amount, v_expected, 'pending', v_batch_key)
  returning id, submitted_at into v_id, v_submitted_at;

  if v_existing_batch is null then
    insert into public.community_remittance_submission_orders
      (submission_id, order_id, notebook_name, product_total, discount_amount, payable_amount)
    select v_id, o.id, o.notebook_name, totals.product_total,
           least(20, totals.product_total), greatest(totals.product_total - least(20, totals.product_total), 0)
    from public.community_orders o
    cross join lateral (
      select coalesce(sum(i.subtotal) filter (where i.purchase_status = 'bought'), 0) as product_total
      from public.community_order_items i where i.order_id = o.id
    ) totals
    where o.id = any(v_order_ids);
  else
    insert into public.community_remittance_submission_orders
      (submission_id, order_id, notebook_name, product_total, discount_amount, payable_amount)
    select v_id, d.order_id, d.notebook_name, d.product_total, d.discount_amount, d.payable_amount
    from public.community_remittance_submission_orders d
    where d.submission_id = (
      select s.id from public.community_remittance_submissions s
      where s.batch_key = v_batch_key and s.id <> v_id order by s.submitted_at desc, s.id desc limit 1
    );
  end if;

  return jsonb_build_object(
    'id', v_id, 'batchId', v_batch_key, 'orderIds', v_order_ids, 'submittedAt', v_submitted_at,
    'productTotal', v_product_total, 'discountTotal', v_discount_total, 'expectedAmount', v_expected,
    'cumulativeReceived', v_received, 'remainingAmount', greatest(v_expected - v_received, 0), 'status', 'pending'
  );
end;
$$;

drop function if exists public.backend_list_community_remittances(integer);

create function public.backend_list_community_remittances(p_limit integer default 100)
returns table (
  id uuid, batch_id uuid, order_id uuid, order_ids uuid[], nickname text, notebook_names text[], notebook_details jsonb,
  product_total numeric, discount_total numeric, expected_amount numeric, bank text, account_last5 text, amount numeric,
  cumulative_received numeric, remaining_amount numeric, overpaid_amount numeric, submitted_at timestamptz, status text,
  rejection_reason text, reviewed_at timestamptz, refunded_at timestamptz, refund_amount numeric, refund_completed_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select s.id, s.batch_key, s.order_ids[1], s.order_ids, s.nickname,
    array(select d.notebook_name from public.community_remittance_submission_orders d where d.submission_id = s.id order by d.notebook_name),
    coalesce((select jsonb_agg(jsonb_build_object('orderId', d.order_id, 'notebookName', d.notebook_name,
      'productTotal', d.product_total, 'discountAmount', d.discount_amount, 'payableAmount', d.payable_amount) order by d.notebook_name)
      from public.community_remittance_submission_orders d where d.submission_id = s.id), '[]'::jsonb),
    coalesce((select sum(d.product_total) from public.community_remittance_submission_orders d where d.submission_id = s.id), s.expected_amount),
    coalesce((select sum(d.discount_amount) from public.community_remittance_submission_orders d where d.submission_id = s.id), 0),
    s.expected_amount, s.bank, s.account_last5, s.amount,
    coalesce((select sum(p.amount) from public.community_remittance_submissions p where p.batch_key = s.batch_key
      and p.status in ('approved','topup_required','overpaid_pending_refund','refund_completed')), 0),
    greatest(s.expected_amount - coalesce((select sum(p.amount) from public.community_remittance_submissions p where p.batch_key = s.batch_key
      and p.status in ('approved','topup_required','overpaid_pending_refund','refund_completed')), 0), 0),
    greatest(coalesce((select sum(p.amount) from public.community_remittance_submissions p where p.batch_key = s.batch_key
      and p.status in ('approved','topup_required','overpaid_pending_refund','refund_completed')), 0) - s.expected_amount, 0),
    s.submitted_at, s.status, s.rejection_reason, s.reviewed_at, s.refunded_at,
    coalesce(r.amount, 0), r.completed_at
  from public.community_remittance_submissions s
  left join public.community_payment_refunds r on r.submission_id = s.id
  order by s.submitted_at desc, s.id desc
  limit least(greatest(coalesce(p_limit, 100), 1), 300);
$$;

create or replace function public.backend_review_community_remittance(p_submission_id uuid, p_decision text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_submission public.community_remittance_submissions%rowtype;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_expected numeric; v_prior_received numeric; v_cumulative numeric; v_status text;
begin
  if p_decision not in ('approved','rejected') then raise exception 'invalid_decision'; end if;
  if p_decision = 'rejected' and v_reason is null then raise exception 'rejection_reason_required'; end if;
  select * into v_submission from public.community_remittance_submissions where id = p_submission_id for update;
  if v_submission.id is null then raise exception 'submission_not_found'; end if;
  if v_submission.status <> 'pending' then raise exception 'submission_already_reviewed'; end if;
  v_expected := v_submission.expected_amount;
  select coalesce(sum(s.amount),0) into v_prior_received from public.community_remittance_submissions s
  where s.batch_key = v_submission.batch_key and s.id <> p_submission_id
    and s.status in ('approved','topup_required','overpaid_pending_refund','refund_completed');
  if p_decision = 'rejected' then v_status := 'rejected'; v_cumulative := v_prior_received;
  else
    v_cumulative := v_prior_received + v_submission.amount;
    v_status := case when v_cumulative < v_expected then 'topup_required'
      when v_cumulative > v_expected then 'overpaid_pending_refund' else 'approved' end;
  end if;
  update public.community_remittance_submissions set status=v_status,
    rejection_reason=case when v_status='rejected' then v_reason else null end, reviewed_at=now()
  where id=p_submission_id;
  update public.community_orders set payment_status=case when v_cumulative >= v_expected and v_expected > 0
    then 'paid'::public.community_payment_status else 'unpaid'::public.community_payment_status end
  where id=any(v_submission.order_ids);
  return jsonb_build_object('id',p_submission_id,'batchId',v_submission.batch_key,'status',v_status,
    'expectedAmount',v_expected,'cumulativeReceived',v_cumulative,'remainingAmount',greatest(v_expected-v_cumulative,0),
    'overpaidAmount',greatest(v_cumulative-v_expected,0),'reviewedAt',now());
end; $$;

create or replace function public.backend_complete_community_refund(p_submission_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_submission public.community_remittance_submissions%rowtype;
  v_received numeric; v_refund numeric; v_refund_id uuid; v_completed_at timestamptz;
begin
  select * into v_submission from public.community_remittance_submissions where id=p_submission_id for update;
  if v_submission.id is null then raise exception 'submission_not_found'; end if;
  if v_submission.status <> 'overpaid_pending_refund' then raise exception 'refund_not_pending'; end if;
  select coalesce(sum(s.amount),0) into v_received from public.community_remittance_submissions s
  where s.batch_key=v_submission.batch_key and s.status in ('approved','topup_required','overpaid_pending_refund','refund_completed');
  v_refund := greatest(v_received-v_submission.expected_amount,0);
  if v_refund <= 0 then raise exception 'no_refund_due'; end if;
  insert into public.community_payment_refunds(submission_id,order_id,amount,batch_key)
  values(p_submission_id,v_submission.order_ids[1],v_refund,v_submission.batch_key)
  returning id,completed_at into v_refund_id,v_completed_at;
  update public.community_remittance_submissions set status='refund_completed',refunded_at=v_completed_at where id=p_submission_id;
  return jsonb_build_object('id',v_refund_id,'submissionId',p_submission_id,'batchId',v_submission.batch_key,
    'status','refund_completed','refundAmount',v_refund,'completedAt',v_completed_at);
end; $$;

revoke all on table public.community_remittance_submission_orders from public;
revoke all on function public.submit_community_remittance(text,uuid[],text,text,numeric) from public;
revoke all on function public.backend_list_community_remittances(integer) from public;
revoke all on function public.backend_review_community_remittance(uuid,text,text) from public;
revoke all on function public.backend_complete_community_refund(uuid) from public;
grant execute on function public.submit_community_remittance(text,uuid[],text,text,numeric) to service_role;
grant execute on function public.backend_list_community_remittances(integer) to service_role;
grant execute on function public.backend_review_community_remittance(uuid,text,text) to service_role;
grant execute on function public.backend_complete_community_refund(uuid) to service_role;
