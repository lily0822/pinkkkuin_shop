-- 連線代購 LINE 下單改版 第三階段審查修正：
-- 1. 匯款金額改成客人可回報跟系統不同——community_livestream_remittances
--    新增 expected_amount_at_submit，記錄「送出匯款當下」系統即時重算
--    出來的應收金額（不是客人選「連線」那一刻的舊快照），純供後台參考
--    對照用；既有的 amount 欄位回到原本語意：客人實際回報/確認的金額。
-- 2. 送出匯款改成單一交易的 RPC（submit_livestream_remittance），避免
--    LINE webhook 重送或客人連點造成同一批訂單產生兩筆匯款紀錄——用
--    SELECT ... FOR UPDATE 鎖定這批訂單列再檢查資格，寫入跟鎖定在同一個
--    交易裡完成，重複呼叫時第二次一定會看到第一次已經寫入的
--    remittance_id，直接擋下不會重複建立。
-- 3. 匯款紀錄的 session_id 填入「這批訂單所屬的場次」——橫跨多場時取
--    starts_at 最晚（最近）的一場；都沒有場次歸屬就是 null（後台顯示
--    「未分場次」）。

alter table public.community_livestream_remittances
  add column if not exists expected_amount_at_submit numeric(12, 2);

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
  v_valid_count integer;
  v_requested_count integer;
  v_session_id uuid;
  v_expected_amount numeric(12, 2);
  v_remittance public.community_livestream_remittances;
begin
  v_requested_count := coalesce(array_length(p_order_ids, 1), 0);
  if v_requested_count = 0 then
    raise exception 'empty_order_ids';
  end if;

  -- 鎖定「這批 id 裡、現在仍然符合資格」的訂單列，再數有幾筆——
  -- FOR UPDATE 不能跟聚合函式（count）用在同一個 SELECT 裡（Postgres
  -- 語法限制：0A000 FOR UPDATE is not allowed with aggregate functions），
  -- 所以拆成子查詢先鎖定，外層再對鎖定結果數數。並行呼叫（LINE webhook
  -- 重送、客人連點）會被序列化：後面的呼叫一定會等前一個交易 commit
  -- 後才繼續，屆時 remittance_id 已經不是 null，WHERE 條件自然篩掉
  -- 那些列，v_valid_count 會小於 v_requested_count，直接整批拒絕，
  -- 不會寫入第二筆。
  select count(*) into v_valid_count
  from (
    select 1
    from public.community_livestream_orders
    where id = any(p_order_ids)
      and line_user_id = p_line_user_id
      and order_status = 'submitted'
      and remittance_id is null
    for update
  ) locked_rows;

  if v_valid_count <> v_requested_count then
    raise exception 'already_remitted';
  end if;

  -- 送出當下即時重算應收金額，不信任客人選「連線」那一刻的舊快照——
  -- 賣家事後改單價/填採買結果都要反映在這個參考數字上。跟後台其他地方
  -- 同一套「賣家單價 ?? 客人單價 ?? 舊欄位」「買到幾個 ?? 訂購數量」
  -- 公式。
  select coalesce(sum(
    coalesce(o.purchased_quantity, o.quantity) *
    coalesce(o.seller_unit_price, o.customer_unit_price, o.unit_price, 0)
  ), 0)
  into v_expected_amount
  from public.community_livestream_orders o
  where o.id = any(p_order_ids);

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
    p_reported_amount, v_expected_amount, 'live', v_session_id
  )
  returning * into v_remittance;

  update public.community_livestream_orders
  set remittance_id = v_remittance.id, payment_status = 'confirming'
  where id = any(p_order_ids);

  return v_remittance;
end;
$$;

revoke all on function public.submit_livestream_remittance(text, text, uuid[], text, text, numeric) from public;
grant execute on function public.submit_livestream_remittance(text, text, uuid[], text, text, numeric) to service_role;
