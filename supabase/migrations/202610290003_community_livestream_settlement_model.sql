-- 連線代購下單改版 第三版 階段二 第五節：結算模型（先匯款、事後採買、
-- 事後改價）。
--
-- 新增三個欄位：paid_amount（已付金額，累計——同一筆訂單之後可能被
-- 補款多次）、refunded_at／refunded_amount（標記已退款）。
--
-- 結算公式（跟 src/lib/line/livestream-pricing.ts 的
-- computeLivestreamSettlement 同一套，SQL 這裡只在 RPC 內部用到）：
--   有效單價 ＝ seller_unit_price ?? customer_unit_price ?? unit_price
--   應付數量 ＝ purchased_quantity ?? quantity
--   shouldPay ＝ 應付數量 × 有效單價（有效單價為 null 視為「價格未定」，
--     這裡 RPC 內部一律把 null 當 0 參與加總，跟既有 expected_amount
--     算法一致；TS 端顯示時才用「價格未定」字樣跟 0 區分）
--   owed ＝ max(0, shouldPay − paid_amount)
--   refundDue ＝ max(0, paid_amount − shouldPay)

alter table public.community_livestream_orders
  add column if not exists paid_amount numeric(12, 2) not null default 0,
  add column if not exists refunded_at timestamptz,
  add column if not exists refunded_amount numeric(12, 2);

-- 既有資料回填：remittance_id 不為空的既有項目（舊模型下每筆訂單最多
-- 只會被匯款一次），paid_amount ＝ 目前應付金額（避免回填後憑空出現
-- 補款／退款）。remittance_id 為空者維持新欄位預設值 0，不用特別處理。
update public.community_livestream_orders
set paid_amount = coalesce(purchased_quantity, quantity) * coalesce(seller_unit_price, customer_unit_price, unit_price, 0)
where remittance_id is not null;

-- ---------------------------------------------------------------------------
-- submit_livestream_remittance 改寫：
-- 1. 不再用「remittance_id is null」判斷資格——改成「owed > 0」，讓同一筆
--    訂單可以被匯款多次（第一次付清、之後賣家調高單價，客人再匯一次補
--    差額）。
-- 2. 鎖定（FOR UPDATE）仍然鎖「這批 id 裡、屬於這個客人、order_status=
--    'submitted'」的全部列（不先篩 owed，確保併發呼叫會依序鎖到同一批
--    列、看到彼此寫入後的最新 paid_amount，不會算出兩份不一致的 owed）。
--    鎖到的筆數對不上請求筆數（訂單被取消／不屬於這個客人／id 錯誤）
--    一律視為 already_remitted，跟舊版行為一致。
-- 3. 鎖定後重新計算這批列「目前」的 Σowed；全部是 0（這批早就付清、或
--    壓根沒有欠款）就回 already_remitted，防止 LINE webhook 重送或客人
--    連點造成重複送出。
-- 4. 只更新 owed>0 的列：paid_amount 累加該列的 owed、remittance_id 只在
--    目前是 null 時才設成這筆（保留「曾經匯款」標記，之後補款不覆蓋，
--    讓舊的「要查某張訂單第一次是哪筆匯款付的」查法還能用）。
-- 5. expected_amount_at_submit ＝ 這次真正處理掉的 Σowed（不是請求的全部
--    訂單金額——owed=0 的列沒被更新，不該算進這個「這次匯了多少」的
--    參考數字）。
-- ---------------------------------------------------------------------------

create or replace function public.submit_livestream_remittance(
  p_line_user_id text,
  p_nickname text,
  p_order_ids uuid[],
  p_bank_name text,
  p_account_last5 text,
  p_reported_amount numeric
)
returns public.community_livestream_remittances
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requested_count integer;
  v_locked_count integer;
  v_session_id uuid;
  v_total_owed numeric(12, 2);
  v_remittance public.community_livestream_remittances;
begin
  v_requested_count := coalesce(array_length(p_order_ids, 1), 0);
  if v_requested_count = 0 then
    raise exception 'empty_order_ids';
  end if;

  select count(*) into v_locked_count
  from (
    select 1
    from public.community_livestream_orders
    where id = any(p_order_ids)
      and line_user_id = p_line_user_id
      and order_status = 'submitted'
    for update
  ) locked_rows;

  if v_locked_count <> v_requested_count then
    raise exception 'already_remitted';
  end if;

  select coalesce(sum(
    greatest(0,
      coalesce(o.purchased_quantity, o.quantity) * coalesce(o.seller_unit_price, o.customer_unit_price, o.unit_price, 0)
      - o.paid_amount
    )
  ), 0)
  into v_total_owed
  from public.community_livestream_orders o
  where o.id = any(p_order_ids);

  if v_total_owed <= 0 then
    raise exception 'already_remitted';
  end if;

  select s.id into v_session_id
  from public.community_livestream_orders o
  join public.community_livestream_sessions s on s.id = o.session_id
  where o.id = any(p_order_ids)
  order by s.starts_at desc
  limit 1;

  insert into public.community_livestream_remittances (
    line_user_id, nickname, order_ids, bank_name, account_last5,
    amount, expected_amount_at_submit, kind, session_id
  ) values (
    p_line_user_id, p_nickname, p_order_ids, p_bank_name, p_account_last5,
    p_reported_amount, v_total_owed, 'live', v_session_id
  )
  returning * into v_remittance;

  update public.community_livestream_orders o
  set
    paid_amount = o.paid_amount + greatest(0,
      coalesce(o.purchased_quantity, o.quantity) * coalesce(o.seller_unit_price, o.customer_unit_price, o.unit_price, 0)
      - o.paid_amount
    ),
    remittance_id = coalesce(o.remittance_id, v_remittance.id),
    payment_status = 'confirming'
  where o.id = any(p_order_ids)
    and (
      coalesce(o.purchased_quantity, o.quantity) * coalesce(o.seller_unit_price, o.customer_unit_price, o.unit_price, 0)
      - o.paid_amount
    ) > 0;

  return v_remittance;
end;
$$;

revoke all on function public.submit_livestream_remittance(text, text, uuid[], text, text, numeric) from public;
grant execute on function public.submit_livestream_remittance(text, text, uuid[], text, text, numeric) to service_role;

-- ---------------------------------------------------------------------------
-- 標記已退款／取消退款標記——針對「指定客人、指定場次」目前 refundDue>0
-- 的項目一次處理。p_session_id 為 null 代表場次欄位是 null 的舊資料
-- （後台「未分場次」），不是「不篩選任何場次」——跟 GET 匯款紀錄／訂單
-- 列表那幾支路由「場次篩選一律要有一個明確值」的既有慣例一致，由呼叫端
-- （後台路由）負責把畫面上選的「當下連線／最近一場」解析成明確的 uuid
-- 再傳進來。
--
-- 兩支都是單一 UPDATE 陳述式（天生單一交易、原子操作），用 where 子句本身
-- 保證重複呼叫不會重複記錄：標記已退款只影響 refunded_at is null 且
-- refundDue>0 的列；取消標記只影響 refunded_at is not null 的列。回傳值是
-- 實際被改動的筆數，給後台顯示「已處理 N 筆」用。
-- ---------------------------------------------------------------------------

create or replace function public.mark_livestream_customer_refunded(
  p_line_user_id text,
  p_session_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.community_livestream_orders o
  set
    refunded_amount = greatest(0,
      o.paid_amount - coalesce(o.purchased_quantity, o.quantity) * coalesce(o.seller_unit_price, o.customer_unit_price, o.unit_price, 0)
    ),
    paid_amount = coalesce(o.purchased_quantity, o.quantity) * coalesce(o.seller_unit_price, o.customer_unit_price, o.unit_price, 0),
    refunded_at = now()
  where o.line_user_id = p_line_user_id
    and o.order_status = 'submitted'
    and ((p_session_id is null and o.session_id is null) or o.session_id = p_session_id)
    and o.refunded_at is null
    and (
      o.paid_amount - coalesce(o.purchased_quantity, o.quantity) * coalesce(o.seller_unit_price, o.customer_unit_price, o.unit_price, 0)
    ) > 0;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.unmark_livestream_customer_refunded(
  p_line_user_id text,
  p_session_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.community_livestream_orders o
  set
    paid_amount = o.paid_amount + coalesce(o.refunded_amount, 0),
    refunded_at = null,
    refunded_amount = null
  where o.line_user_id = p_line_user_id
    and o.order_status = 'submitted'
    and ((p_session_id is null and o.session_id is null) or o.session_id = p_session_id)
    and o.refunded_at is not null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.mark_livestream_customer_refunded(text, uuid) from public;
grant execute on function public.mark_livestream_customer_refunded(text, uuid) to service_role;
revoke all on function public.unmark_livestream_customer_refunded(text, uuid) from public;
grant execute on function public.unmark_livestream_customer_refunded(text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 驗證 SQL（套用後請在 Staging 執行，確認回填結果合理；非破壞性查詢）：
--
-- 1. 回填後的筆數與金額統計：
--    select count(*) filter (where remittance_id is not null) as remitted_rows,
--           sum(paid_amount) filter (where remittance_id is not null) as remitted_paid_total,
--           count(*) filter (where remittance_id is null and paid_amount <> 0) as unexpected_nonzero_unremitted
--    from public.community_livestream_orders;
--    -- unexpected_nonzero_unremitted 應該是 0（沒匯款過的項目不該有 paid_amount）。
--
-- 2. 回填前後對照（抽樣）：
--    select id, quantity, purchased_quantity, seller_unit_price, customer_unit_price,
--           unit_price, paid_amount, remittance_id
--    from public.community_livestream_orders
--    where remittance_id is not null
--    order by updated_at desc
--    limit 20;
-- ---------------------------------------------------------------------------
