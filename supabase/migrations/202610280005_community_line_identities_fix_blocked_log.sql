-- 修正 submit_community_line_identity 的一個 bug：預先檢查出衝突
-- （v_new_conflict/v_legacy_conflict）時，原本的寫法是「先 insert 一筆
-- blocked 紀錄，緊接著 raise exception 'conflict'」——但這個 raise 沒有
-- 被任何 exception handler 接住，會讓整個函式呼叫（單一交易）直接中止
-- 回滾，連同剛剛那筆 insert 一起被撤銷，導致 blocked 紀錄從來沒有真的
-- 寫進資料庫。這是本機測試（連續呼叫驗證 blocked 紀錄筆數）才抓到的，
-- 光看 SQL 文字看不出來——insert 看起來有執行，但沒有人會在同一個
-- 交易裡「insert 後又讓交易中止」還期待那筆 insert 留下來。
--
-- 修正方式：衝突時只單純 raise exception，不在原地 insert；改成在
-- exception 區塊接住這個例外（用 SQLERRM 文字比對，因為所有自訂例外
-- 都共用同一個 SQLSTATE P0001，沒辦法用 SQLSTATE 區分），在 handler
-- 裡面才真的 insert——plpgsql 的 exception 區塊本身是一個新的
-- subtransaction，在這裡面做的寫入即使外層接著重新 raise、整個函式
-- 呼叫最終還是回報失敗，這個 handler 內的 insert 依然會留下來（跟
-- unique_violation 那個 handler 一直以來的寫法一致，這次只是把「預先
-- 檢查到衝突」這條路徑也改成同一套模式）。

create or replace function public.submit_community_line_identity(
  p_line_user_id text,
  p_line_display_name text,
  p_binding_type text,
  p_binding_value text,
  p_actor text
)
returns public.community_line_identities
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.community_line_identities;
  v_legacy_conflict boolean;
  v_new_conflict boolean;
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

  v_legacy_conflict := false;
  if p_binding_type = 'nickname' then
    select exists(
      select 1 from public.community_line_bindings
      where review_status = 'approved'
        and nickname is not null
        and lower(trim(nickname)) = lower(trim(p_binding_value))
        and line_user_id <> p_line_user_id
    ) into v_legacy_conflict;
  end if;

  -- 這裡改成單純 raise，不在原地 insert blocked 紀錄——交給下面的
  -- exception 區塊統一處理（跟 unique_violation 那條路徑共用同一套
  -- 「先 raise、在 handler 裡才真的寫紀錄」模式）。
  if v_new_conflict or v_legacy_conflict then
    raise exception 'conflict';
  end if;

  if v_existing.id is null then
    v_action := case when p_actor = 'admin' then 'admin_bind' else 'bind' end;

    insert into public.community_line_identities (
      line_user_id, line_display_name, binding_type, binding_value
    ) values (
      p_line_user_id, p_line_display_name, p_binding_type, p_binding_value
    )
    returning * into v_result;

    insert into public.community_line_identity_logs (
      line_user_id, line_display_name, action, new_type, new_value
    ) values (
      p_line_user_id, p_line_display_name, v_action, p_binding_type, p_binding_value
    );
  else
    if v_existing.binding_type = p_binding_type and v_existing.binding_value = p_binding_value then
      raise exception 'unchanged';
    end if;

    v_action := case when p_actor = 'admin' then 'admin_edit' else 'edit' end;

    update public.community_line_identities
    set line_display_name = coalesce(p_line_display_name, line_display_name),
        binding_type = p_binding_type,
        binding_value = p_binding_value
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

  return v_result;
exception
  when unique_violation then
    -- 真正並行寫入撞到資料庫 unique index 的情況（兩個不同的人同時搶
    -- 同一個值，預先檢查當下都還沒看到對方）。
    if p_actor = 'customer' then
      insert into public.community_line_identity_logs (
        line_user_id, line_display_name, action, old_type, old_value, new_type, new_value
      ) values (
        p_line_user_id, p_line_display_name, 'blocked',
        v_existing.binding_type, v_existing.binding_value,
        p_binding_type, p_binding_value
      );
    end if;
    raise exception 'conflict';
  when others then
    -- 上面預先檢查就抓到的衝突（v_new_conflict/v_legacy_conflict）落
    -- 在這裡——所有自訂例外共用同一個 SQLSTATE（P0001），用 SQLERRM
    -- 文字比對出是不是 'conflict'，是的話（而且 actor=customer）才補
    -- 一筆 blocked 紀錄，不管是不是 conflict 都原封不動重新拋出同一個
    -- 錯誤給呼叫端（invalid_type/invalid_value/invalid_actor/unchanged
    -- 這些不該被當成 conflict 處理，也完全不受影響）。
    if SQLERRM = 'conflict' and p_actor = 'customer' then
      insert into public.community_line_identity_logs (
        line_user_id, line_display_name, action, old_type, old_value, new_type, new_value
      ) values (
        p_line_user_id, p_line_display_name, 'blocked',
        v_existing.binding_type, v_existing.binding_value,
        p_binding_type, p_binding_value
      );
    end if;
    raise;
end;
$$;

revoke all on function public.submit_community_line_identity(text, text, text, text, text) from public;
grant execute on function public.submit_community_line_identity(text, text, text, text, text) to service_role;
