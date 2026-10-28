-- 社群綁定功能（暱稱／IG）：新增獨立的兩張表，完全不碰舊表
-- community_line_bindings（社群記事本的通知／出貨／社群名單審核都還在
-- 用它，語意不變、不重用）。這組新表只有一個目的：讓賣家在後台知道
-- 某個 LINE 帳號是社群裡的誰，不做任何授權/通知用途。

-- community_line_identities：每個 LINE 帳號最多一筆現在生效的綁定。
create table if not exists public.community_line_identities (
  id uuid primary key default gen_random_uuid(),
  line_user_id text not null unique,
  line_display_name text,
  binding_type text not null check (binding_type in ('nickname', 'ig')),
  -- 存「正規化後」的值——暱稱保留使用者輸入的大小寫/符號，只處理頭尾
  -- 空白跟連續空白；IG 已經是去 @、去空白、轉小寫過的值。正規化邏輯在
  -- 呼叫端（submit_community_line_identity 的呼叫者）做，這張表只信任
  -- 傳進來的就是正規化後的值。
  binding_value text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint community_line_identities_value_not_blank check (length(trim(binding_value)) > 0)
);

-- 同類型（暱稱/IG）裡，值不分大小寫只能有一個人用——IG 帳號跟暱稱是
-- 分開的命名空間，同一個字串可以一個人當暱稱、另一個人當 IG。
create unique index if not exists community_line_identities_type_value_unique_idx
  on public.community_line_identities (binding_type, lower(binding_value));

drop trigger if exists community_line_identities_set_updated_at on public.community_line_identities;
create trigger community_line_identities_set_updated_at
before update on public.community_line_identities
for each row execute function set_updated_at();

alter table public.community_line_identities enable row level security;
revoke all on public.community_line_identities from anon;
revoke all on public.community_line_identities from authenticated;
revoke all on public.community_line_identities from service_role;
-- 這個專案之前已經踩過好幾次「忘記明確 grant DELETE」的坑
-- （community_line_bot_states、community_line_bindings 都只有
-- select/insert/update，測試資料清不掉）——這張新表從一開始就把
-- delete 一起明確授權，解除綁定／之後要清測試資料都不會卡住。
grant select, insert, update, delete on public.community_line_identities to service_role;

-- community_line_identity_logs：純新增的時間線紀錄，不修改既有列。
create table if not exists public.community_line_identity_logs (
  id uuid primary key default gen_random_uuid(),
  line_user_id text not null,
  line_display_name text,
  action text not null check (action in ('bind', 'edit', 'blocked', 'unbind', 'admin_bind', 'admin_edit')),
  old_type text,
  old_value text,
  new_type text,
  new_value text,
  created_at timestamptz not null default now()
);

create index if not exists community_line_identity_logs_line_user_idx
  on public.community_line_identity_logs (line_user_id, created_at desc);
create index if not exists community_line_identity_logs_created_at_idx
  on public.community_line_identity_logs (created_at desc);

alter table public.community_line_identity_logs enable row level security;
revoke all on public.community_line_identity_logs from anon;
revoke all on public.community_line_identity_logs from authenticated;
revoke all on public.community_line_identity_logs from service_role;
grant select, insert, update, delete on public.community_line_identity_logs to service_role;

-- 綁定／修改——客人跟管理員共用同一支 RPC（p_actor 區分 'customer'／
-- 'admin'，只影響寫進紀錄的 action 名稱跟「被擋下」是否要留紀錄）。
-- 用 pg_advisory_xact_lock(hashtext(line_user_id)) 把同一個人的呼叫序列
-- 化——客人連點兩次、或 LINE webhook 重送，第二個呼叫會等第一個交易
-- commit 後才繼續，屆時會看到已經寫入的資料而走「跟目前一樣」
-- （unchanged）這條路，不會產生重複的綁定或紀錄。不同人之間的衝突
-- （搶同一個值）交給 (binding_type, lower(value)) 的 unique index 在
-- 資料庫層面保證，兩個人真的同時搶時，只有一個 insert/update 會成功，
-- 另一個撞到 unique_violation，在 exception 區塊轉成 'conflict' 錯誤碼
-- （actor=customer 時順便補一筆 blocked 紀錄）。
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

  -- 新表裡「別人」已經用掉這個值
  select exists(
    select 1 from public.community_line_identities
    where binding_type = p_binding_type
      and lower(binding_value) = lower(p_binding_value)
      and line_user_id <> p_line_user_id
  ) into v_new_conflict;

  -- 暱稱另外檢查舊表（社群記事本）裡「已核准」的綁定，避免同一個暱稱
  -- 在新舊兩套系統裡分別屬於不同的人，造成賣家混淆。
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
end;
$$;

revoke all on function public.submit_community_line_identity(text, text, text, text, text) from public;
grant execute on function public.submit_community_line_identity(text, text, text, text, text) to service_role;

-- 解除綁定——只給後台用（前台沒有任何入口可以叫到這支）。
create or replace function public.unbind_community_line_identity(
  p_line_user_id text
)
returns void
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
    raise exception 'not_bound';
  end if;

  delete from public.community_line_identities where id = v_existing.id;

  insert into public.community_line_identity_logs (
    line_user_id, line_display_name, action, old_type, old_value
  ) values (
    p_line_user_id, v_existing.line_display_name, 'unbind', v_existing.binding_type, v_existing.binding_value
  );
end;
$$;

revoke all on function public.unbind_community_line_identity(text) from public;
grant execute on function public.unbind_community_line_identity(text) to service_role;
