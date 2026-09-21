create table if not exists public.community_line_bindings (
  id uuid primary key default gen_random_uuid(),
  line_user_id text not null unique,
  line_display_name text,
  nickname text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint community_line_bindings_nickname_not_blank check (length(trim(nickname)) > 0)
);

create unique index if not exists community_line_bindings_nickname_unique_idx
  on public.community_line_bindings (lower(trim(nickname)));

drop trigger if exists community_line_bindings_set_updated_at on public.community_line_bindings;
create trigger community_line_bindings_set_updated_at
before update on public.community_line_bindings
for each row execute function set_updated_at();

alter table public.community_line_bindings enable row level security;

revoke all on public.community_line_bindings from anon;
revoke all on public.community_line_bindings from authenticated;
revoke all on public.community_line_bindings from service_role;
grant select, insert, update on public.community_line_bindings to service_role;
