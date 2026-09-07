create table if not exists member_line_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  line_user_id text not null unique,
  linked_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists member_line_accounts_linked_at_idx
  on member_line_accounts(linked_at desc);

drop trigger if exists member_line_accounts_set_updated_at on member_line_accounts;
create trigger member_line_accounts_set_updated_at
before update on member_line_accounts
for each row execute function set_updated_at();

alter table member_line_accounts enable row level security;

grant select, delete on member_line_accounts to authenticated;
grant select, insert, update, delete on member_line_accounts to service_role;

drop policy if exists "Members can read own line binding" on member_line_accounts;
create policy "Members can read own line binding"
on member_line_accounts for select
to authenticated
using (auth.uid() is not null and user_id = auth.uid());

drop policy if exists "Members can delete own line binding" on member_line_accounts;
create policy "Members can delete own line binding"
on member_line_accounts for delete
to authenticated
using (auth.uid() is not null and user_id = auth.uid());
