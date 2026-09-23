create table if not exists public.community_line_notifications (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('bought', 'arrived', 'marketplace_ready')),
  target_id uuid not null,
  nickname text not null,
  line_user_id text,
  status text not null default 'not_notified' check (status in ('not_notified', 'sent', 'failed')),
  error_message text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint community_line_notifications_kind_target_unique unique (kind, target_id)
);

create index if not exists community_line_notifications_created_at_idx
  on public.community_line_notifications (created_at desc);

drop trigger if exists community_line_notifications_set_updated_at on public.community_line_notifications;
create trigger community_line_notifications_set_updated_at
before update on public.community_line_notifications
for each row execute function set_updated_at();

alter table public.community_line_notifications enable row level security;

revoke all on public.community_line_notifications from anon;
revoke all on public.community_line_notifications from authenticated;
revoke all on public.community_line_notifications from service_role;

grant select, insert, update on public.community_line_notifications to service_role;
