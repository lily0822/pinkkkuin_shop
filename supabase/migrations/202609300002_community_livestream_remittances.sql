-- 自助匯款申報 (LINE 對話，比照「我要下單」的模式). 全新、獨立於
-- community_orders / community_remittance_submissions 的資料——舊表存的是
-- 客人自己匯出的帳戶資訊，這裡存的是「客人這次申報要核對哪些
-- community_livestream_orders、金額多少」，只跟本功能的訂單表關聯。

create table if not exists public.community_livestream_remittances (
  id uuid primary key default gen_random_uuid(),
  line_user_id text not null,
  nickname text not null,
  order_ids uuid[] not null,
  account_last5 text not null,
  -- 觸發當下算好的金額快照，不是之後即時加總——避免訂單內容在客人回覆
  -- 後 5 碼之前被改動（例如管理員手動改了單價/數量）導致金額對不上。
  amount numeric(12, 2) not null,
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint community_livestream_remittances_last5_check check (account_last5 ~ '^[0-9]{5}$'),
  constraint community_livestream_remittances_order_ids_check check (array_length(order_ids, 1) > 0)
);

create index if not exists community_livestream_remittances_line_user_idx
  on public.community_livestream_remittances (line_user_id);
create index if not exists community_livestream_remittances_submitted_at_idx
  on public.community_livestream_remittances (submitted_at desc);
create index if not exists community_livestream_remittances_order_ids_idx
  on public.community_livestream_remittances using gin (order_ids);

alter table public.community_livestream_remittances enable row level security;

revoke all on public.community_livestream_remittances from anon;
revoke all on public.community_livestream_remittances from authenticated;
revoke all on public.community_livestream_remittances from service_role;
-- Append-only submission log — no update/delete grant, matching how the
-- rest of this feature's tables are scoped (service_role only, minimum
-- grant needed for how the code actually uses the table).
grant select, insert on public.community_livestream_remittances to service_role;

-- Extend the existing minimal bot-state table (202609290001) with the
-- remittance conversation's own small state: whether this user is currently
-- being asked for their account's last-5-digits, and — snapshotted at
-- trigger time — which order_ids and what total amount that reply should
-- resolve to (so a late reply can't drift from what the customer was shown).
alter table public.community_line_bot_states
  add column if not exists awaiting_remittance_last5 boolean not null default false,
  add column if not exists remittance_order_ids uuid[],
  add column if not exists remittance_amount numeric(12, 2);
