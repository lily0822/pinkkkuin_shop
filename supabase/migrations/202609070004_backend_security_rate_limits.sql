create table if not exists public.backend_security_rate_limits (
  scope text not null,
  bucket_key text not null,
  request_count integer not null default 0,
  reset_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (scope, bucket_key)
);

alter table public.backend_security_rate_limits enable row level security;

revoke all on public.backend_security_rate_limits from anon;
revoke all on public.backend_security_rate_limits from authenticated;
revoke all on public.backend_security_rate_limits from service_role;
grant select, insert, update, delete on public.backend_security_rate_limits to service_role;

create or replace function public.backend_hit_rate_limit(
  p_scope text,
  p_bucket_key text,
  p_limit integer,
  p_window_seconds integer
)
returns table (
  allowed boolean,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.backend_security_rate_limits%rowtype;
  now_value timestamptz := now();
  window_seconds integer := least(greatest(coalesce(p_window_seconds, 60), 1), 3600);
  max_count integer := least(greatest(coalesce(p_limit, 60), 1), 1000);
begin
  if nullif(trim(coalesce(p_scope, '')), '') is null
    or nullif(trim(coalesce(p_bucket_key, '')), '') is null
  then
    allowed := false;
    retry_after_seconds := 60;
    return next;
    return;
  end if;

  insert into public.backend_security_rate_limits as limits (
    scope,
    bucket_key,
    request_count,
    reset_at,
    updated_at
  )
  values (
    trim(p_scope),
    trim(p_bucket_key),
    1,
    now_value + make_interval(secs => window_seconds),
    now_value
  )
  on conflict (scope, bucket_key)
  do update set
    request_count = case
      when limits.reset_at <= now_value then 1
      else limits.request_count + 1
    end,
    reset_at = case
      when limits.reset_at <= now_value then now_value + make_interval(secs => window_seconds)
      else limits.reset_at
    end,
    updated_at = now_value
  returning * into current_row;

  allowed := current_row.request_count <= max_count;
  retry_after_seconds := greatest(0, ceil(extract(epoch from (current_row.reset_at - now_value)))::integer);
  return next;
end;
$$;

revoke all on function public.backend_hit_rate_limit(text, text, integer, integer) from public;
grant execute on function public.backend_hit_rate_limit(text, text, integer, integer) to service_role;
