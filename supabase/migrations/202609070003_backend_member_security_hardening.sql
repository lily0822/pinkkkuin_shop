create table if not exists public.backend_security_audit_logs (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  target_user_id uuid references auth.users(id) on delete set null,
  admin_session_id text,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint backend_security_audit_logs_action_check
    check (action in ('member_pii_reveal', 'member_disable', 'member_reenable'))
);

create index if not exists backend_security_audit_logs_created_at_idx
  on public.backend_security_audit_logs(created_at desc);

create index if not exists backend_security_audit_logs_target_user_id_idx
  on public.backend_security_audit_logs(target_user_id, created_at desc);

alter table public.backend_security_audit_logs enable row level security;

revoke all on public.backend_security_audit_logs from anon;
revoke all on public.backend_security_audit_logs from authenticated;
revoke all on public.backend_security_audit_logs from service_role;
grant insert, select on public.backend_security_audit_logs to service_role;

revoke truncate, references, trigger on public.member_profiles from service_role;
revoke truncate, references, trigger on public.member_addresses from service_role;
revoke truncate, references, trigger on public.member_line_accounts from service_role;
revoke truncate, references, trigger on public.orders from service_role;
revoke truncate, references, trigger on public.order_items from service_role;

grant select, insert, update on public.member_profiles to service_role;
grant select on public.member_addresses to service_role;
grant select, insert, update, delete on public.member_line_accounts to service_role;
grant select on public.orders to service_role;
grant select on public.order_items to service_role;
