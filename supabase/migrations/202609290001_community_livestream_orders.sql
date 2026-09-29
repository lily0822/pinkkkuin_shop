-- 社群連線訂單 (LINE image ordering). A brand-new, fully independent feature:
-- does NOT touch community_orders / community_order_items / community_line_bindings
-- (that table is only ever read from here, never altered). No shared rows,
-- no shared IDs with the existing 記事本 system.

do $$ begin
  create type community_livestream_purchase_status as enum ('not_bought', 'confirming', 'bought');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type community_livestream_payment_status as enum ('unpaid', 'confirming', 'paid');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.community_livestream_orders (
  id uuid primary key default gen_random_uuid(),
  -- null for rows created via the backend's Excel import (manual add), since
  -- those were never tied to a real LINE message.
  line_user_id text,
  line_display_name text,
  nickname text not null,
  -- Vision-recognition output (or manual/Excel entry). Both null means "could
  -- not be recognized" — the admin UI's "無法辨識價格" filter is unit_price
  -- is null, not product_name, since price is the number that actually
  -- matters for the order.
  product_name text,
  unit_price numeric(12, 2),
  recognized_confidence numeric(4, 3),
  quantity integer not null default 1,
  total_price numeric(12, 2) generated always as (
    case when unit_price is null then null else unit_price * quantity end
  ) stored,
  purchase_status community_livestream_purchase_status not null default 'not_bought',
  payment_status community_livestream_payment_status not null default 'unpaid',
  notes text,
  -- Path inside the private "community-livestream-photos" storage bucket;
  -- null for Excel-imported rows. The backend only ever shows this via a
  -- short-lived signed URL, never a public link.
  photo_storage_path text,
  source text not null default 'line',
  -- Set once this row has been included in a Flex carousel actually sent
  -- back to the customer (see community_line_bot_states below for the
  -- "still queued" side of this). Null = still waiting for the next
  -- carousel batch.
  carousel_sent_at timestamptz,
  -- Set the first time purchase_status flips to 'bought', so the backend
  -- only ever pushes the "訂單已確認" LINE notification once per row.
  confirmed_notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint community_livestream_orders_quantity_positive check (quantity > 0),
  constraint community_livestream_orders_source_check check (source in ('line', 'excel_import'))
);

create index if not exists community_livestream_orders_nickname_idx
  on public.community_livestream_orders (lower(nickname));
create index if not exists community_livestream_orders_line_user_idx
  on public.community_livestream_orders (line_user_id);
create index if not exists community_livestream_orders_pending_carousel_idx
  on public.community_livestream_orders (line_user_id, created_at)
  where carousel_sent_at is null;
create index if not exists community_livestream_orders_created_at_idx
  on public.community_livestream_orders (created_at desc);

drop trigger if exists community_livestream_orders_set_updated_at on public.community_livestream_orders;
create trigger community_livestream_orders_set_updated_at
before update on public.community_livestream_orders
for each row execute function set_updated_at();

-- Minimal per-user LINE bot conversation state — deliberately just two
-- booleans/columns instead of a full conversation-management system:
--  - awaiting_nickname: the bot just asked "請輸入您的社群暱稱" and the
--    customer's next text message should be read as that nickname, not
--    matched against any keyword.
--  - awaiting_quantity_for_order_id: the customer tapped "5件以上" on one
--    pending row and the bot is waiting for them to type a plain number.
create table if not exists public.community_line_bot_states (
  line_user_id text primary key,
  awaiting_nickname boolean not null default false,
  awaiting_quantity_for_order_id uuid references public.community_livestream_orders(id) on delete set null,
  updated_at timestamptz not null default now()
);

drop trigger if exists community_line_bot_states_set_updated_at on public.community_line_bot_states;
create trigger community_line_bot_states_set_updated_at
before update on public.community_line_bot_states
for each row execute function set_updated_at();

alter table public.community_livestream_orders enable row level security;
alter table public.community_line_bot_states enable row level security;

revoke all on public.community_livestream_orders from anon;
revoke all on public.community_livestream_orders from authenticated;
revoke all on public.community_livestream_orders from service_role;
grant select, insert, update on public.community_livestream_orders to service_role;

revoke all on public.community_line_bot_states from anon;
revoke all on public.community_line_bot_states from authenticated;
revoke all on public.community_line_bot_states from service_role;
grant select, insert, update on public.community_line_bot_states to service_role;
