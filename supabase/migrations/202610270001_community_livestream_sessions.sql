-- 連線代購 LINE 下單改版 第一階段：「連線場次」這個時間範圍的概念——取代
-- 現在「永遠只有一個進行中」的隱性假設。同一時間只能有一個場次，靠
-- exclusion constraint 在資料庫層面擋住重疊（API 層也會先查一次給出可讀
-- 的錯誤訊息，這裡是最後一道防線）。tstzrange 原生支援 gist exclusion，
-- 不需要額外裝 btree_gist extension。

create table if not exists public.community_livestream_sessions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint community_livestream_sessions_time_check check (ends_at > starts_at),
  exclude using gist (tstzrange(starts_at, ends_at, '[)') with &&)
);

drop trigger if exists community_livestream_sessions_set_updated_at on public.community_livestream_sessions;
create trigger community_livestream_sessions_set_updated_at
before update on public.community_livestream_sessions
for each row execute function set_updated_at();

alter table public.community_livestream_sessions enable row level security;

revoke all on public.community_livestream_sessions from anon;
revoke all on public.community_livestream_sessions from authenticated;
revoke all on public.community_livestream_sessions from service_role;
grant select, insert, update, delete on public.community_livestream_sessions to service_role;
