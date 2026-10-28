-- 上一版（202610280005）的修正方向本身是對的，但還是不夠——真正的
-- 根因是：這支函式最終還是用 RAISE EXCEPTION 把 'conflict' 回報給呼叫
-- 端。即使 exception handler 裡有 insert 一筆 blocked 紀錄，只要函式
-- 呼叫這個「單一 SQL 陳述式」最終還是以錯誤收場，PostgREST/Supabase
-- 幫這次呼叫開的外層交易就會整個回滾——exception handler 的
-- subtransaction 只保證「跟外層其他語句」隔離，不保證「函式呼叫本身
-- 失敗時這個 handler 做的事情還能活下來」。上一版在本機重新測試後
-- 證實 blocked 紀錄還是沒有寫進去，才發現這一層。
--
-- 正確做法：'conflict'（以及 'unchanged'）這兩種「預期內的業務結果」
-- 不要用 RAISE EXCEPTION 回報，改成函式正常 return 一個 jsonb
-- （{"ok":false,"error":"conflict"} 或 {"ok":true,"identity":{...}}）——
-- 函式呼叫本身永遠成功結束，交易正常 commit，blocked 紀錄自然會留下
-- 來；呼叫端（live-identity-rpc.ts）改成檢查回傳 jsonb 裡的 ok 欄位，
-- 不再靠 PostgREST 的 error 物件判斷。unique_violation 那條路徑
-- （真正並行寫入撞到 unique index）也比照辦理，不再 RAISE。
-- invalid_type/invalid_value/invalid_actor 這三個純粹是呼叫端參數寫錯
-- 的防呆（不是客人操作會走到的業務結果，也沒有任何東西需要保留），
-- 維持 RAISE EXCEPTION 没有影響。

-- 回傳型別從 public.community_line_identities 改成 jsonb——Postgres 不
-- 允許 CREATE OR REPLACE 改變既有函式的回傳型別，要先明確 DROP 再重建。
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

  if v_new_conflict or v_legacy_conflict then
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
      return jsonb_build_object('ok', false, 'error', 'unchanged');
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
