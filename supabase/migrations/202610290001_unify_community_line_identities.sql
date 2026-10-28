-- 統一綁定：所有「用暱稱找 LINE 客人」的功能改讀新表
-- community_line_identities，不再讀舊表 community_line_bindings。記事本
-- （出貨/面交/LINE 通知）仍在使用，只是找人的方式改走新表。舊表資料
-- 保留在資料庫、不刪除、不改動——這份 migration 只搬移「已核准」的資料
-- 過去，pending 的申請原封不動留著。

-- ---------------------------------------------------------------------------
-- 1. 新增欄位：needs_review（隱私保護——客人自己綁定、撞到記事本既有
--    客人名字時，綁定仍立即成功，但先標記待核准，不用於通知/查找，避免
--    客人填別人的名字就能收到對方通知）、reviewed_at、last_actor（記錄
--    這筆綁定最後一次是誰動的，給之後記事本匯入後的重新比對用——只有
--    「客人自己綁的、現在還沒核准過」的才需要重新比對，admin 代綁/
--    搬移進來的不用）。
-- ---------------------------------------------------------------------------

alter table public.community_line_identities
  add column if not exists needs_review boolean not null default false,
  add column if not exists reviewed_at timestamptz,
  add column if not exists last_actor text not null default 'customer'
    check (last_actor in ('customer', 'admin', 'migrated'));

-- 回填既有列的 last_actor——用每個 line_user_id 最新一筆 bind/edit 類型的
-- log 動作推斷（找不到對應 log 的，維持欄位預設值 'customer'，這是
-- 「安全預設」：之後的重新比對寧可多檢查一次，也不要漏掉真正該核准的
-- 衝突）。
with latest_actions as (
  select distinct on (line_user_id) line_user_id, action
  from public.community_line_identity_logs
  where action in ('bind', 'edit', 'admin_bind', 'admin_edit')
  order by line_user_id, created_at desc
)
update public.community_line_identities i
set last_actor = case when la.action in ('admin_bind', 'admin_edit') then 'admin' else 'customer' end
from latest_actions la
where la.line_user_id = i.line_user_id;

-- ---------------------------------------------------------------------------
-- 2. community_line_identity_logs 的 action 允許值增加 'migrated'（資料
--    搬移寫入）、'approved'（待核准 → 核准）、'flagged'（記事本匯入新
--    資料後，重新比對發現撞名，被動標記待核准——跟「blocked」不同，
--    blocked 是客人當下送出綁定被擋下，flagged 是之後因為記事本資料變了
--    才發現衝突）。CHECK constraint 不能直接 ALTER，要 drop 再 add。
-- ---------------------------------------------------------------------------

alter table public.community_line_identity_logs drop constraint if exists community_line_identity_logs_action_check;
alter table public.community_line_identity_logs add constraint community_line_identity_logs_action_check
  check (action in ('bind', 'edit', 'blocked', 'unbind', 'admin_bind', 'admin_edit', 'migrated', 'approved', 'flagged'));

-- ---------------------------------------------------------------------------
-- 3. 資料搬移：把舊表 community_line_bindings 裡 review_status='approved'
--    且 nickname 有值的列搬進新表。略過兩種情況（不報錯、安靜跳過）：
--    (a) 這個 line_user_id 在新表已經有綁定（新綁定優先，不覆蓋）；
--    (b) 正規化後的值已經被新表裡別人用掉。
--    同一批次內部如果剛好有兩筆舊資料正規化後撞名（理論上舊表自己的
--    審核不該放行這種情況，這裡防禦性地用 DISTINCT ON 去重，只留固定
--    順序的第一筆，避免這批 INSERT 自己內部撞到 unique index）。
--    搬移進來的一律 needs_review=false、last_actor='migrated'——這是賣家
--    已經審過的資料，不需要再跑一次撞名檢查。
-- ---------------------------------------------------------------------------

with candidates as (
  select
    b.line_user_id,
    b.line_display_name,
    trim(b.nickname) as binding_value
  from public.community_line_bindings b
  where b.review_status = 'approved'
    and b.nickname is not null
    and length(trim(b.nickname)) > 0
    and not exists (
      select 1 from public.community_line_identities i
      where i.line_user_id = b.line_user_id
    )
    and not exists (
      select 1 from public.community_line_identities i2
      where i2.binding_type = 'nickname'
        and lower(i2.binding_value) = lower(trim(b.nickname))
    )
),
deduped as (
  select distinct on (lower(binding_value)) line_user_id, line_display_name, binding_value
  from candidates
  order by lower(binding_value), line_user_id
),
inserted as (
  insert into public.community_line_identities
    (line_user_id, line_display_name, binding_type, binding_value, needs_review, last_actor)
  select line_user_id, line_display_name, 'nickname', binding_value, false, 'migrated'
  from deduped
  returning line_user_id, line_display_name, binding_value
)
insert into public.community_line_identity_logs (line_user_id, line_display_name, action, new_type, new_value)
select line_user_id, line_display_name, 'migrated', 'nickname', binding_value
from inserted;

-- ---------------------------------------------------------------------------
-- 4. submit_community_line_identity：拿掉舊表的衝突檢查（新表現在是
--    單一事實來源），改成檢查客人自己綁定的值是否與記事本既有客人名單
--    撞名（community_orders.nickname，trim+小寫+去掉開頭 @ 兩邊都做）。
--    撞到的話綁定仍然成功（客人體感不變），但 needs_review=true；
--    actor='admin' 一律 needs_review=false（賣家代綁，信任賣家已經確認
--    過）。回傳型別維持 jsonb（202610280006 的教訓：業務結果用正常
--    RETURN，不要 RAISE EXCEPTION，否則失敗時連 blocked 紀錄都會被整個
--    回滾）。
-- ---------------------------------------------------------------------------

drop function if exists public.submit_community_line_identity(text, text, text, text, text);

create function public.submit_community_line_identity(
  p_line_user_id text,
  p_line_display_name text,
  p_binding_type text,
  p_binding_value text,
  p_actor text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.community_line_identities;
  v_new_conflict boolean;
  v_needs_review boolean;
  v_action text;
  v_result public.community_line_identities;
begin
  if p_binding_type not in ('nickname', 'ig') then
    raise exception 'invalid_type';
  end if;
  if length(trim(coalesce(p_binding_value, ''))) = 0 then
    raise exception 'invalid_value';
  end if;
  if p_actor not in ('customer', 'admin') then
    raise exception 'invalid_actor';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_line_user_id));

  select * into v_existing
    from public.community_line_identities
    where line_user_id = p_line_user_id;

  select exists(
    select 1 from public.community_line_identities
    where binding_type = p_binding_type
      and lower(binding_value) = lower(p_binding_value)
      and line_user_id <> p_line_user_id
  ) into v_new_conflict;

  if v_new_conflict then
    if p_actor = 'customer' then
      insert into public.community_line_identity_logs (
        line_user_id, line_display_name, action, old_type, old_value, new_type, new_value
      ) values (
        p_line_user_id, p_line_display_name, 'blocked',
        v_existing.binding_type, v_existing.binding_value,
        p_binding_type, p_binding_value
      );
    end if;
    return jsonb_build_object('ok', false, 'error', 'conflict');
  end if;

  -- 隱私保護：客人自己綁定時，檢查正規化後的值是否跟記事本既有客人名單
  -- 撞名——記事本的通知是「用暱稱找人」，客人如果填了別人在記事本裡的
  -- 名字，在核准之前這筆綁定不能被拿去找人/發通知。
  v_needs_review := false;
  if p_actor = 'customer' then
    select exists(
      select 1 from public.community_orders o
      where lower(regexp_replace(trim(o.nickname), '^@+', '')) = lower(regexp_replace(trim(p_binding_value), '^@+', ''))
    ) into v_needs_review;
  end if;

  if v_existing.id is null then
    v_action := case when p_actor = 'admin' then 'admin_bind' else 'bind' end;

    insert into public.community_line_identities (
      line_user_id, line_display_name, binding_type, binding_value, needs_review, last_actor
    ) values (
      p_line_user_id, p_line_display_name, p_binding_type, p_binding_value, v_needs_review,
      case when p_actor = 'admin' then 'admin' else 'customer' end
    )
    returning * into v_result;

    insert into public.community_line_identity_logs (
      line_user_id, line_display_name, action, new_type, new_value
    ) values (
      p_line_user_id, p_line_display_name, v_action, p_binding_type, p_binding_value
    );
  else
    if v_existing.binding_type = p_binding_type and v_existing.binding_value = p_binding_value then
      return jsonb_build_object('ok', false, 'error', 'unchanged');
    end if;

    v_action := case when p_actor = 'admin' then 'admin_edit' else 'edit' end;

    update public.community_line_identities
    set line_display_name = coalesce(p_line_display_name, line_display_name),
        binding_type = p_binding_type,
        binding_value = p_binding_value,
        needs_review = v_needs_review,
        reviewed_at = case when v_needs_review then null else reviewed_at end,
        last_actor = case when p_actor = 'admin' then 'admin' else 'customer' end
    where id = v_existing.id
    returning * into v_result;

    insert into public.community_line_identity_logs (
      line_user_id, line_display_name, action, old_type, old_value, new_type, new_value
    ) values (
      p_line_user_id, p_line_display_name, v_action,
      v_existing.binding_type, v_existing.binding_value,
      p_binding_type, p_binding_value
    );
  end if;

  return jsonb_build_object('ok', true, 'identity', to_jsonb(v_result));
exception
  when unique_violation then
    if p_actor = 'customer' then
      insert into public.community_line_identity_logs (
        line_user_id, line_display_name, action, old_type, old_value, new_type, new_value
      ) values (
        p_line_user_id, p_line_display_name, 'blocked',
        v_existing.binding_type, v_existing.binding_value,
        p_binding_type, p_binding_value
      );
    end if;
    return jsonb_build_object('ok', false, 'error', 'conflict');
end;
$$;

revoke all on function public.submit_community_line_identity(text, text, text, text, text) from public;
grant execute on function public.submit_community_line_identity(text, text, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 5. 核准待核准的綁定（後台「核准」按鈕用）。冪等：已經是
--    needs_review=false 時直接回傳目前狀態，不重複寫紀錄。
-- ---------------------------------------------------------------------------

create or replace function public.approve_community_line_identity(
  p_line_user_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.community_line_identities;
begin
  perform pg_advisory_xact_lock(hashtext(p_line_user_id));

  select * into v_existing
    from public.community_line_identities
    where line_user_id = p_line_user_id;

  if v_existing.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_bound');
  end if;

  if v_existing.needs_review = false then
    return jsonb_build_object('ok', true, 'identity', to_jsonb(v_existing));
  end if;

  update public.community_line_identities
  set needs_review = false, reviewed_at = now()
  where id = v_existing.id
  returning * into v_existing;

  insert into public.community_line_identity_logs (
    line_user_id, line_display_name, action, new_type, new_value
  ) values (
    p_line_user_id, v_existing.line_display_name, 'approved', v_existing.binding_type, v_existing.binding_value
  );

  return jsonb_build_object('ok', true, 'identity', to_jsonb(v_existing));
end;
$$;

revoke all on function public.approve_community_line_identity(text) from public;
grant execute on function public.approve_community_line_identity(text) to service_role;

-- ---------------------------------------------------------------------------
-- 6. 重新比對（記事本匯入新資料後呼叫）：把「客人自己綁的（last_actor=
--    'customer'）、目前還沒標記待核准」的綁定，重新檢查是否撞到記事本
--    最新的客人名單，撞到的話標記 needs_review=true、寫一筆 'flagged'
--    紀錄。只影響原本就是客人自己綁的——admin 代綁/搬移進來的不受影響
--    （賣家已經確認過，不會因為記事本後來新增資料而被動翻案）。回傳這次
--    新標記的筆數。
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

revoke all on function public.rescan_community_line_identities_needs_review() from public;
grant execute on function public.rescan_community_line_identities_needs_review() to service_role;

-- ---------------------------------------------------------------------------
-- 7. 依暱稱找 LINE 使用者（給記事本通知/後台顯示用）——只採用
--    needs_review=false 的綁定，正規化規則（trim+小寫+去掉開頭 @）跟
--    RPC 裡的撞名檢查、跟應用層 src/lib/line/live-bindings.ts 的呼叫端
--    統一同一套。單筆 + 批次兩種版本，批次版本給一次要處理很多筆訂單的
--    列表頁用（避免一筆訂單一次查詢）。
-- ---------------------------------------------------------------------------

create or replace function public.find_line_user_id_by_nickname(p_value text)
returns text
language sql
stable
set search_path = public
as $$
  select i.line_user_id
  from public.community_line_identities i
  where i.needs_review = false
    and lower(regexp_replace(trim(i.binding_value), '^@+', '')) = lower(regexp_replace(trim(p_value), '^@+', ''))
  limit 1
$$;

revoke all on function public.find_line_user_id_by_nickname(text) from public;
grant execute on function public.find_line_user_id_by_nickname(text) to service_role;

create or replace function public.find_line_user_ids_by_nicknames(p_values text[])
returns table(input_value text, line_user_id text)
language sql
stable
set search_path = public
as $$
  select v.input_value, i.line_user_id
  from unnest(p_values) as v(input_value)
  join public.community_line_identities i
    on i.needs_review = false
   and lower(regexp_replace(trim(i.binding_value), '^@+', '')) = lower(regexp_replace(trim(v.input_value), '^@+', ''))
$$;

revoke all on function public.find_line_user_ids_by_nicknames(text[]) from public;
grant execute on function public.find_line_user_ids_by_nicknames(text[]) to service_role;

-- 給「後台顯示」用的版本——跟上面兩個不同：不過濾 needs_review，連
-- 「還沒核准」的綁定也要顯示出來（但要讓賣家看得出來還沒驗證），所以
-- 額外把 needs_review 跟 line_display_name 一起回傳。社群訂單/出貨明細
-- 畫面用這支，不是用來找人發通知的 find_line_user_id(s)_by_nickname。
create or replace function public.find_line_identities_by_nicknames(p_values text[])
returns table(input_value text, line_user_id text, line_display_name text, needs_review boolean)
language sql
stable
set search_path = public
as $$
  select v.input_value, i.line_user_id, i.line_display_name, i.needs_review
  from unnest(p_values) as v(input_value)
  join public.community_line_identities i
    on lower(regexp_replace(trim(i.binding_value), '^@+', '')) = lower(regexp_replace(trim(v.input_value), '^@+', ''))
$$;

revoke all on function public.find_line_identities_by_nicknames(text[]) from public;
grant execute on function public.find_line_identities_by_nicknames(text[]) to service_role;

-- ---------------------------------------------------------------------------
-- 驗證用 SELECT（讀取用，不是 migration 的一部分，套用完可以自己在
-- SQL Editor 跑來核對搬移結果——這裡用註解包起來，不會隨 migration 自動
-- 執行）：
--
-- -- 搬移後新表筆數 vs 舊表已核准筆數
-- select count(*) as new_table_total from public.community_line_identities;
-- select count(*) as legacy_approved_total from public.community_line_bindings
--   where review_status = 'approved' and nickname is not null and length(trim(nickname)) > 0;
-- select count(*) as migrated_count from public.community_line_identities where last_actor = 'migrated';
--
-- -- 被略過的舊資料（line_user_id 已經在新表 / 撞到新表既有的值），附原因
-- select b.line_user_id, b.nickname, b.line_display_name,
--   case
--     when exists (select 1 from public.community_line_identities i where i.line_user_id = b.line_user_id)
--       then 'line_user_id 已經在新表有別的綁定'
--     when exists (select 1 from public.community_line_identities i2 where i2.binding_type = 'nickname'
--       and lower(i2.binding_value) = lower(trim(b.nickname)) and i2.last_actor <> 'migrated')
--       then '這個暱稱已經被新表裡別人用掉'
--     else '同一批次內部撞名，只留了其中一筆'
--   end as skip_reason
-- from public.community_line_bindings b
-- where b.review_status = 'approved' and b.nickname is not null and length(trim(b.nickname)) > 0
--   and not exists (
--     select 1 from public.community_line_identities i3
--     where i3.last_actor = 'migrated' and i3.line_user_id = b.line_user_id and i3.binding_value = trim(b.nickname)
--   );
--
-- -- 舊表 pending 申請清單（不搬移，列出來給使用者決定怎麼處理）
-- select line_user_id, line_display_name, requested_nickname, created_at
-- from public.community_line_bindings
-- where review_status = 'pending'
-- order by created_at desc;
-- ---------------------------------------------------------------------------
