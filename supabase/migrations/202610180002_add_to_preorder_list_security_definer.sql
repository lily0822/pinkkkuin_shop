-- 修正 add_to_preorder_list()：上一份 migration
-- （202610180001_preorder_series.sql）沒有指定 security definer/invoker，
-- Postgres 預設是 security invoker，實際用測試會員的 access token 呼叫
-- 時得到 "permission denied for table products"——authenticated 角色對
-- products/product_variants 這兩張表沒有任何 schema grant（只有 RLS
-- policy，沒有 grant 的話 RLS 根本不會被評估到，直接在權限檢查這關就
-- 被擋下來），不是「authenticated 本來就能讀」這個當初錯誤的假設。
--
-- 改成 security definer，跟專案裡其他需要讀 products/orders 的函式
-- （create_storefront_order、create_preorder_registration）同一個模式：
-- 函式內部用 auth.uid() 自己做範圍限制（只能動自己的
-- preorder_list_items 列），不是靠呼叫者的 grant 做授權，security
-- definer 只是讓函式「讀商品資料」這個動作本身能執行，不是放寬了誰能
-- 呼叫這支函式、或誰的清單會被動到。
create or replace function add_to_preorder_list(
  p_product_id uuid,
  p_variant_id uuid default null,
  p_quantity integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user_id uuid := auth.uid();
  v_quantity integer := greatest(1, coalesce(p_quantity, 1));
  product_record products%rowtype;
  variant_record product_variants%rowtype;
  existing_id uuid;
  existing_quantity integer;
  result_quantity integer;
begin
  if v_user_id is null then
    raise exception '請先登入會員。' using errcode = 'P0001';
  end if;

  select * into product_record from products where id = p_product_id;
  if not found or product_record.status <> 'active' or product_record.product_type <> 'preorder' then
    raise exception '這個商品目前無法加入預購清單。' using errcode = 'P0001';
  end if;

  if p_variant_id is not null then
    select * into variant_record from product_variants where id = p_variant_id and product_id = p_product_id;
    if not found or variant_record.status <> 'active' then
      raise exception '這個規格目前無法加入預購清單。' using errcode = 'P0001';
    end if;
  end if;

  select id, quantity into existing_id, existing_quantity
    from preorder_list_items
    where user_id = v_user_id
      and product_id = p_product_id
      and coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = coalesce(p_variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
    for update;

  if existing_id is not null then
    result_quantity := existing_quantity + v_quantity;
    update preorder_list_items set quantity = result_quantity where id = existing_id;
  else
    insert into preorder_list_items (user_id, product_id, variant_id, quantity)
    values (v_user_id, p_product_id, p_variant_id, v_quantity)
    returning quantity into result_quantity;
  end if;

  return jsonb_build_object('quantity', result_quantity);
end;
$$;

revoke all on function add_to_preorder_list(uuid, uuid, integer) from public;
grant execute on function add_to_preorder_list(uuid, uuid, integer) to authenticated;
