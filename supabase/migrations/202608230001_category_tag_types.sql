alter table categories
  add column if not exists type text not null default 'category',
  add column if not exists enabled boolean not null default true,
  add column if not exists sort_order integer not null default 0;

alter table categories
  drop constraint if exists categories_type_check;

alter table categories
  add constraint categories_type_check
  check (type in ('ip', 'category'));

create index if not exists categories_type_sort_idx
on categories(type, enabled, sort_order, name);
