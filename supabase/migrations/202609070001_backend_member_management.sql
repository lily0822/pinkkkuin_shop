create or replace function public.backend_list_members(
  p_q text default '',
  p_line_status text default 'all',
  p_status text default 'all',
  p_page integer default 1,
  p_page_size integer default 20
)
returns table (
  total_count bigint,
  user_id uuid,
  created_at timestamptz,
  email text,
  email_verified boolean,
  display_name text,
  phone text,
  status text,
  line_linked boolean,
  line_linked_at timestamptz,
  order_count bigint,
  last_order_at timestamptz
)
language sql
security definer
set search_path = public, auth
as $$
  with order_stats as (
    select
      orders.user_id,
      count(*)::bigint as order_count,
      max(orders.created_at) as last_order_at
    from public.orders
    where orders.user_id is not null
    group by orders.user_id
  ),
  filtered as (
    select
      users.id as user_id,
      users.created_at,
      coalesce(users.email, '') as email,
      users.email_confirmed_at is not null as email_verified,
      coalesce(profiles.display_name, '') as display_name,
      coalesce(profiles.phone, '') as phone,
      coalesce(profiles.status, 'active') as status,
      line_accounts.user_id is not null as line_linked,
      line_accounts.linked_at as line_linked_at,
      coalesce(order_stats.order_count, 0)::bigint as order_count,
      order_stats.last_order_at
    from auth.users
    left join public.member_profiles profiles on profiles.user_id = users.id
    left join public.member_line_accounts line_accounts on line_accounts.user_id = users.id
    left join order_stats on order_stats.user_id = users.id
    where (
      nullif(trim(coalesce(p_q, '')), '') is null
      or users.email ilike '%' || trim(p_q) || '%'
      or profiles.display_name ilike '%' || trim(p_q) || '%'
      or profiles.phone ilike '%' || trim(p_q) || '%'
    )
    and (
      coalesce(p_status, 'all') = 'all'
      or coalesce(profiles.status, 'active') = p_status
    )
    and (
      coalesce(p_line_status, 'all') = 'all'
      or (p_line_status = 'linked' and line_accounts.user_id is not null)
      or (p_line_status = 'unlinked' and line_accounts.user_id is null)
    )
  )
  select
    count(*) over()::bigint as total_count,
    filtered.user_id,
    filtered.created_at,
    filtered.email,
    filtered.email_verified,
    filtered.display_name,
    filtered.phone,
    filtered.status,
    filtered.line_linked,
    filtered.line_linked_at,
    filtered.order_count,
    filtered.last_order_at
  from filtered
  order by filtered.created_at desc, filtered.user_id desc
  limit least(greatest(coalesce(p_page_size, 20), 1), 50)
  offset (greatest(coalesce(p_page, 1), 1) - 1) * least(greatest(coalesce(p_page_size, 20), 1), 50);
$$;

create or replace function public.backend_get_member_detail(p_user_id uuid)
returns jsonb
language sql
security definer
set search_path = public, auth
as $$
  select jsonb_build_object(
    'user', jsonb_build_object(
      'userId', users.id,
      'createdAt', users.created_at,
      'email', coalesce(users.email, ''),
      'emailVerified', users.email_confirmed_at is not null
    ),
    'profile', jsonb_build_object(
      'displayName', coalesce(profiles.display_name, ''),
      'phone', coalesce(profiles.phone, ''),
      'status', coalesce(profiles.status, 'active'),
      'createdAt', profiles.created_at,
      'updatedAt', profiles.updated_at
    ),
    'line', jsonb_build_object(
      'linked', line_accounts.user_id is not null,
      'linkedAt', line_accounts.linked_at
    ),
    'addresses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', addresses.id,
        'recipientName', addresses.recipient_name,
        'phone', addresses.phone,
        'postalCode', addresses.postal_code,
        'city', addresses.city,
        'district', addresses.district,
        'addressLine', addresses.address_line,
        'isDefault', addresses.is_default,
        'createdAt', addresses.created_at
      ) order by addresses.is_default desc, addresses.created_at desc)
      from public.member_addresses addresses
      where addresses.user_id = users.id
    ), '[]'::jsonb),
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', orders.id,
        'orderNo', orders.order_no,
        'orderType', orders.order_type,
        'createdAt', orders.created_at,
        'total', orders.total,
        'status', orders.status,
        'paymentStatus', orders.payment_status,
        'shippingStatus', orders.shipping_status
      ) order by orders.created_at desc)
      from (
        select *
        from public.orders
        where orders.user_id = users.id
        order by orders.created_at desc
        limit 30
      ) orders
    ), '[]'::jsonb)
  )
  from auth.users
  left join public.member_profiles profiles on profiles.user_id = users.id
  left join public.member_line_accounts line_accounts on line_accounts.user_id = users.id
  where users.id = p_user_id
  limit 1;
$$;

revoke all on function public.backend_list_members(text, text, text, integer, integer) from public;
revoke all on function public.backend_get_member_detail(uuid) from public;
grant execute on function public.backend_list_members(text, text, text, integer, integer) to service_role;
grant execute on function public.backend_get_member_detail(uuid) to service_role;
