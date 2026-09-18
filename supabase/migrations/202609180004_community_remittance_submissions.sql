create table if not exists public.community_remittance_submissions (
  id uuid primary key default gen_random_uuid(),
  nickname text not null,
  order_ids uuid[] not null,
  bank text not null,
  account_last5 text not null,
  amount numeric(12, 2) not null,
  expected_amount numeric(12, 2) not null,
  submitted_at timestamptz not null default now(),
  constraint community_remittance_submissions_last5_check check (account_last5 ~ '^[0-9]{5}$'),
  constraint community_remittance_submissions_order_ids_check check (array_length(order_ids, 1) > 0)
);

create index if not exists community_remittance_submissions_nickname_idx
  on public.community_remittance_submissions (lower(nickname));
create index if not exists community_remittance_submissions_submitted_at_idx
  on public.community_remittance_submissions (submitted_at desc);

alter table public.community_remittance_submissions enable row level security;

revoke all on public.community_remittance_submissions from anon;
revoke all on public.community_remittance_submissions from authenticated;
revoke all on public.community_remittance_submissions from service_role;
grant select, insert on public.community_remittance_submissions to service_role;

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
  v_expected numeric;
  v_matched_count integer;
  v_id uuid;
  v_submitted_at timestamptz;
begin
  if v_nickname is null or v_bank is null or v_last5 is null then
    raise exception 'invalid_input';
  end if;
  if v_last5 !~ '^[0-9]{5}$' then
    raise exception 'invalid_last5';
  end if;
  if p_order_ids is null or array_length(p_order_ids, 1) is null then
    raise exception 'no_orders';
  end if;
  if v_amount <= 0 then
    raise exception 'invalid_amount';
  end if;

  select count(*) into v_matched_count
  from public.community_orders o
  where o.id = any(p_order_ids)
    and lower(trim(o.nickname)) = lower(v_nickname);

  if v_matched_count <> array_length(p_order_ids, 1) then
    raise exception 'order_nickname_mismatch';
  end if;

  select coalesce(sum(i.subtotal), 0) - 20 * array_length(p_order_ids, 1)
  into v_expected
  from public.community_order_items i
  where i.order_id = any(p_order_ids);

  insert into public.community_remittance_submissions
    (nickname, order_ids, bank, account_last5, amount, expected_amount)
  values
    (v_nickname, p_order_ids, v_bank, v_last5, v_amount, coalesce(v_expected, 0))
  returning id, submitted_at into v_id, v_submitted_at;

  return jsonb_build_object(
    'id', v_id,
    'submittedAt', v_submitted_at,
    'expectedAmount', coalesce(v_expected, 0)
  );
end;
$$;

create or replace function public.backend_list_community_remittances(p_limit integer default 50)
returns table (
  id uuid,
  nickname text,
  notebook_names text[],
  bank text,
  account_last5 text,
  amount numeric,
  expected_amount numeric,
  submitted_at timestamptz
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
    s.submitted_at
  from public.community_remittance_submissions s
  order by s.submitted_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;

revoke all on function public.submit_community_remittance(text, uuid[], text, text, numeric) from public;
revoke all on function public.backend_list_community_remittances(integer) from public;

grant execute on function public.submit_community_remittance(text, uuid[], text, text, numeric) to service_role;
grant execute on function public.backend_list_community_remittances(integer) to service_role;
