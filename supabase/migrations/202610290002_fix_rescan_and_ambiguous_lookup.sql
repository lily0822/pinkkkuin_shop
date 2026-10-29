-- 202610290001 已經套用到 Staging，不要再改那個檔案——這份是追加修正，
-- 用 create or replace function 覆蓋三支函式，三支的參數/回傳型別都沒變，
-- 不需要先 drop。修的是審查後發現的兩個問題：

-- ---------------------------------------------------------------------------
-- 問題 1：rescan_community_line_identities_needs_review 原本只看
-- last_actor='customer' + needs_review=false，沒有排除「已經核准過」的
-- 綁定——賣家核准一筆之後，只要記事本那筆撞名的客人資料還在，下次重新
-- 匯入記事本時會被 rescan 重新標記回待核准，等於賣家核准的決定會被
-- 自動翻案。approve_community_line_identity 只改 needs_review/reviewed_at，
-- 不改 last_actor（核准後 last_actor 仍然是 'customer'，因為這筆綁定本身
-- 還是客人自己填的，只是賣家確認過人沒有錯），所以要新增一個條件
-- `reviewed_at is null`——核准過的綁定一定有 reviewed_at，永遠不會再被
-- rescan 碰到。
-- ---------------------------------------------------------------------------

create or replace function public.rescan_community_line_identities_needs_review()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with flagged as (
    update public.community_line_identities i
    set needs_review = true
    where i.last_actor = 'customer'
      and i.needs_review = false
      and i.reviewed_at is null
      and exists (
        select 1 from public.community_orders o
        where lower(regexp_replace(trim(o.nickname), '^@+', '')) = lower(regexp_replace(trim(i.binding_value), '^@+', ''))
      )
    returning i.line_user_id, i.line_display_name, i.binding_type, i.binding_value
  ),
  logged as (
    insert into public.community_line_identity_logs (line_user_id, line_display_name, action, new_type, new_value)
    select line_user_id, line_display_name, 'flagged', binding_type, binding_value from flagged
    returning 1
  )
  select count(*) into v_count from flagged;

  return coalesce(v_count, 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- 問題 2：find_line_user_id_by_nickname／find_line_user_ids_by_nicknames
-- （只採用 needs_review=false 的查找函式，給記事本通知/找人用）原本在
-- 「同一個正規化後的名字同時對應到不只一個 line_user_id」（例如一位客人
-- 的暱稱跟另一位客人的 IG 正規化後剛好一樣——binding_type 本來就是分開
-- 的命名空間，這種情況在設計上是允許發生的）時，單筆版本用 limit 1
-- 任選一筆、批次版本會回傳多列（呼叫端等於拿到不確定是誰的結果）。改成
-- 兩邊都判斷「這個名字目前符合的 line_user_id 是否剛好只有 1 個相異值」，
-- 不是的話（0 個或 >1 個都一樣）視為「找不到」，回傳空——歧義的情況
-- 不要任選一個，記事本通知/後台找人都不該送給一個可能選錯的人。
-- find_line_identities_by_nicknames（後台顯示用，不過濾 needs_review）
-- 保持不變，繼續回傳全部符合的列——是否歧義交給呼叫端（TS 那層）判斷
-- 並顯示「對應到多位 LINE 客人，請確認」，不在資料庫這層就濾掉，顯示
-- 畫面需要看到完整清單才能讓賣家自己判斷。
-- ---------------------------------------------------------------------------

create or replace function public.find_line_user_id_by_nickname(p_value text)
returns text
language sql
stable
set search_path = public
as $$
  select case when count(*) = 1 then min(i.line_user_id) else null end
  from public.community_line_identities i
  where i.needs_review = false
    and lower(regexp_replace(trim(i.binding_value), '^@+', '')) = lower(regexp_replace(trim(p_value), '^@+', ''))
$$;

create or replace function public.find_line_user_ids_by_nicknames(p_values text[])
returns table(input_value text, line_user_id text)
language sql
stable
set search_path = public
as $$
  select v.input_value, min(i.line_user_id) as line_user_id
  from unnest(p_values) as v(input_value)
  join public.community_line_identities i
    on i.needs_review = false
   and lower(regexp_replace(trim(i.binding_value), '^@+', '')) = lower(regexp_replace(trim(v.input_value), '^@+', ''))
  group by v.input_value
  having count(distinct i.line_user_id) = 1
$$;
