alter table public.community_remittance_submissions
  add column if not exists status text not null default 'pending',
  add column if not exists rejection_reason text,
  add column if not exists reviewed_at timestamptz;

do $$ begin
  alter table public.community_remittance_submissions
    add constraint community_remittance_submissions_status_check
    check (status in ('pending', 'approved', 'rejected'));
exception
  when duplicate_object then null;
end $$;

create index if not exists community_remittance_submissions_status_idx
  on public.community_remittance_submissions (status, submitted_at desc);

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
  v_id uuid;
  v_submitted_at timestamptz;
  v_latest_status text;
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
    and lower(trim(o.nickname)) = lower(v_nickname);

  if v_order_id is null then
    raise exception 'order_nickname_mismatch';
  end if;

  select s.status into v_latest_status
  from public.community_remittance_submissions s
  where v_order_id = any(s.order_ids)
  order by s.submitted_at desc, s.id desc
  limit 1;

  if v_latest_status in ('pending', 'approved') then
    raise exception 'payment_already_active';
  end if;

  select coalesce(sum(i.subtotal) filter (where i.purchase_status = 'bought'), 0)
  into v_expected
  from public.community_order_items i
  where i.order_id = v_order_id;

  if coalesce(v_expected, 0) <= 0 then
    raise exception 'no_payable_items';
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
    'status', 'pending'
  );
end;
$$;

drop function if exists public.backend_list_community_remittances(integer);

create function public.backend_list_community_remittances(p_limit integer default 50)
returns table (
  id uuid,
  nickname text,
  notebook_names text[],
  bank text,
  account_last5 text,
  amount numeric,
  expected_amount numeric,
  submitted_at timestamptz,
  status text,
  rejection_reason text,
  reviewed_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    s.id,
    s.nickname,
    (
      select array_agg(o.notebook_name order by o.notebook_name)
      from public.community_orders o
      where o.id = any(s.order_ids)
    ) as notebook_names,
    s.bank,
    s.account_last5,
    s.amount,
    s.expected_amount,
    s.submitted_at,
    s.status,
    s.rejection_reason,
    s.reviewed_at
  from public.community_remittance_submissions s
  order by s.submitted_at desc, s.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
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

  update public.community_remittance_submissions
  set status = p_decision,
      rejection_reason = case when p_decision = 'rejected' then v_reason else null end,
      reviewed_at = now()
  where id = p_submission_id;

  update public.community_orders
  set payment_status = case
    when p_decision = 'approved' then 'paid'::public.community_payment_status
    else 'unpaid'::public.community_payment_status
  end
  where id = any(v_submission.order_ids);

  return jsonb_build_object(
    'id', p_submission_id,
    'status', p_decision,
    'reviewedAt', now()
  );
end;
$$;

revoke all on function public.submit_community_remittance(text, uuid[], text, text, numeric) from public;
revoke all on function public.backend_list_community_remittances(integer) from public;
revoke all on function public.backend_review_community_remittance(uuid, text, text) from public;

grant execute on function public.submit_community_remittance(text, uuid[], text, text, numeric) to service_role;
grant execute on function public.backend_list_community_remittances(integer) to service_role;
grant execute on function public.backend_review_community_remittance(uuid, text, text) to service_role;
