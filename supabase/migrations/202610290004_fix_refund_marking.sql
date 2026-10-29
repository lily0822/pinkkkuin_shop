-- 202610290003 已經套用到資料庫，不要再改那個檔案——這份是審查後的
-- 追加修正，只用 create or replace function 覆蓋
-- mark_livestream_customer_refunded，參數跟回傳型別都沒變，不需要先
-- drop。unmark_livestream_customer_refunded 不用改（邏輯本來就正確，
-- 只是後台確認視窗的說明文字要補充，那是前端改動，不需要 migration）。
--
-- ---------------------------------------------------------------------------
-- 問題：mark_livestream_customer_refunded 原本的 where 子句含
-- `o.refunded_at is null`，代表一筆訂單只能被標記退款一次——已經標記過
-- 的項目，之後如果又因為賣家調整單價/採買結果而重新出現 refundDue>0
-- （例如：標記退款後賣家又把單價調低一點、或原本以為全部退款了但其實
-- 只退了一部分），沒辦法再被標記，後台「標記已退款」按鈕點了也不會有
-- 任何效果（因為 where 子句直接把這筆排除在外）。
--
-- 修正：拿掉 `refunded_at is null` 這個條件，改成「只要 refundDue>0 就
-- 處理」，不管這筆以前有沒有被標記過。refunded_amount 改成累加（這筆
-- 訂單可能被標記退款多次，每次代表不同時間點的應退款）：
-- `coalesce(refunded_amount, 0) + 這次的 refundDue`。refunded_at 更新成
-- 最近一次標記的時間。標記後 paid_amount 會等於當下的 shouldPay，
-- refundDue 變回 0，所以重複呼叫（沒有新的應退款出現）天然不會再次
-- 處理到這筆——跟原本「單一 UPDATE 陳述式、where 子句本身保證冪等」的
-- 設計精神一致，只是冪等的判斷依據從「有沒有標記過」改成「現在還有沒有
-- 應退款」。
--
-- 取消退款標記（unmark）的效果因此也跟著變成「還原到這筆訂單第一次被
-- 標記退款之前的狀態」——因為 refunded_amount 現在是累加的，unmark 把
-- 全部累加的金額一次加回 paid_amount、清空兩個欄位，等於撤銷了「所有」
-- 標記退款的動作，不是只撤銷最近一次。這點已經在後台「標記已退款」/
-- 「取消標記」的確認視窗文字裡說明，不需要改這支函式本身。
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
    refunded_amount = coalesce(o.refunded_amount, 0) + greatest(0,
      o.paid_amount - coalesce(o.purchased_quantity, o.quantity) * coalesce(o.seller_unit_price, o.customer_unit_price, o.unit_price, 0)
    ),
    paid_amount = coalesce(o.purchased_quantity, o.quantity) * coalesce(o.seller_unit_price, o.customer_unit_price, o.unit_price, 0),
    refunded_at = now()
  where o.line_user_id = p_line_user_id
    and o.order_status = 'submitted'
    and ((p_session_id is null and o.session_id is null) or o.session_id = p_session_id)
    and (
      o.paid_amount - coalesce(o.purchased_quantity, o.quantity) * coalesce(o.seller_unit_price, o.customer_unit_price, o.unit_price, 0)
    ) > 0;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.mark_livestream_customer_refunded(text, uuid) from public;
grant execute on function public.mark_livestream_customer_refunded(text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 驗證 SQL（套用後請在 Staging 執行，非破壞性查詢）：
--
-- 找一位已經標記過退款、但現在又因為改價/採買結果而重新出現應退款的
-- 客人（如果目前沒有真實資料符合，可以用 Utest 測試資料建一筆來跑）：
-- select id, line_user_id, quantity, purchased_quantity, seller_unit_price,
--        customer_unit_price, unit_price, paid_amount, refunded_at, refunded_amount
-- from public.community_livestream_orders
-- where refunded_at is not null
-- order by updated_at desc
-- limit 20;
--
-- 呼叫 select mark_livestream_customer_refunded('<line_user_id>', '<session_id 或 null>');
-- 確認回傳筆數 >0、該筆 paid_amount 變成新的 shouldPay、refunded_amount
-- 變成「舊的 refunded_amount + 這次的 refundDue」（累加，不是覆蓋）。
-- ---------------------------------------------------------------------------
