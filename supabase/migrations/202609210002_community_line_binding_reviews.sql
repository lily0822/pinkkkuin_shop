alter table public.community_line_bindings
  alter column nickname drop not null,
  add column if not exists requested_nickname text,
  add column if not exists review_status text not null default 'not_requested',
  add column if not exists approved_at timestamptz;

update public.community_line_bindings
set review_status = 'approved',
    approved_at = coalesce(approved_at, updated_at, created_at)
where nickname is not null
  and length(trim(nickname)) > 0;

alter table public.community_line_bindings
  drop constraint if exists community_line_bindings_review_status_check;

alter table public.community_line_bindings
  add constraint community_line_bindings_review_status_check
  check (review_status in ('not_requested', 'pending', 'approved'));

create index if not exists community_line_bindings_review_status_idx
  on public.community_line_bindings (review_status, updated_at desc);

revoke all on public.community_line_bindings from anon;
revoke all on public.community_line_bindings from authenticated;
revoke all on public.community_line_bindings from service_role;
grant select, insert, update on public.community_line_bindings to service_role;
