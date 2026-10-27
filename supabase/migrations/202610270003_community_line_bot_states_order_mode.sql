-- 連線代購 LINE 下單改版 第一階段：community_line_bot_states 加「下單
-- 模式」與「匯款流程」需要的欄位。remit_* 系列是第三階段匯款流程才會
-- 真的讀寫，這次只是跟著一次建好（migration 一次寫完，使用者只需要套用
-- 一次）；既有的 awaiting_remittance_last5/remittance_order_ids/
-- remittance_amount 三個舊欄位繼續給現有的「我要匯款」文字回報流程用
-- （第一階段不動它），不重複建一套。

alter table public.community_line_bot_states
  add column if not exists order_mode text check (order_mode in ('ordering')),
  add column if not exists order_session_id uuid references public.community_livestream_sessions(id),
  add column if not exists order_last_activity_at timestamptz,
  add column if not exists order_burst_replied boolean not null default false,
  add column if not exists remit_step text,
  add column if not exists remit_kind text check (remit_kind in ('live', 'preorder')),
  add column if not exists remit_bank text,
  add column if not exists remit_expected_amount numeric(12, 2),
  add column if not exists remit_order_ids uuid[];
