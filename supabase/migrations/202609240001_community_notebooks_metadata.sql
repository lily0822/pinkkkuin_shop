-- Backward-compatible: purely additive. community_orders.notebook_name stays
-- the source of truth for which notebooks exist; this table only stores
-- optional admin-entered metadata (order date, expected shipment timing) per
-- notebook name, looked up by name. A notebook with no row here just shows
-- as "未設定" in the admin UI — nothing about the existing order/item status
-- flow depends on this table.

do $$ begin
  create type community_shipment_time_precision as enum ('unknown', 'early', 'mid', 'late', 'end_of_month', 'exact');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.community_notebooks (
  id uuid primary key default gen_random_uuid(),
  notebook_name text not null,
  ordered_date date,
  expected_shipment_month text,
  expected_shipment_precision community_shipment_time_precision not null default 'unknown',
  expected_shipment_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (notebook_name)
);

create index if not exists community_notebooks_name_idx on public.community_notebooks (lower(notebook_name));
create index if not exists community_notebooks_ordered_date_idx on public.community_notebooks (ordered_date);
create index if not exists community_notebooks_expected_month_idx on public.community_notebooks (expected_shipment_month);

drop trigger if exists community_notebooks_set_updated_at on public.community_notebooks;
create trigger community_notebooks_set_updated_at
before update on public.community_notebooks
for each row execute function set_updated_at();

alter table public.community_notebooks enable row level security;

revoke all on public.community_notebooks from anon;
revoke all on public.community_notebooks from authenticated;
revoke all on public.community_notebooks from service_role;

grant select, insert, update on public.community_notebooks to service_role;
