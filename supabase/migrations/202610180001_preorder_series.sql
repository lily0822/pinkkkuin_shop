-- 預購獨立流程：系列管理取代標籤批次機制。
--
-- 新表 product_series：後台「預購系列管理」畫面維護的系列清單，name
-- 直接當記事本連結的批次識別依據（取代上一輪 preorder-link-batches.ts
-- 那張 batchName -> categoryId 的 schedule_settings KV 對照表，少一層
-- 間接——這次改成直接查這張表）。
create table if not exists product_series (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  cover_image_url text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists product_series_sort_idx on product_series(sort_order, name);

alter table product_series enable row level security;

-- 比照 categories 的「Public can read」慣例：系列清單是前台 /category/
-- preorder 頁面要顯示的公開資料，不是會員限定資料。這張表是這次新建的
-- （不是沿用既有 categories），不能依賴任何可能已經存在、但這次沒驗證過
-- 的預設權限——anon/authenticated/service_role 三個角色都在這裡明確
-- grant，不假設 Supabase 專案層級的 default privileges 一定會自動套用
-- 到新表（這份專案已經確認過 service_role 對新表完全不會有預設權限）。
grant select on product_series to anon;
grant select on product_series to authenticated;
grant select, insert, update, delete on product_series to service_role;

drop policy if exists "Public can read product series" on product_series;
create policy "Public can read product series"
on product_series for select
using (true);

-- products 新增兩個欄位：
-- 1. series_id：現貨商品不用填（nullable）；預購商品「必須選系列」是
--    後台表單層級驗證（saveBackendProduct），不是資料庫 constraint——
--    但刪除系列時如果底下還有商品歸屬，用 on delete restrict 當最後一道
--    防線，跟後台畫面本身的刪除保護檢查疊加，不是互相替代。
-- 2. estimated_arrival_date：預計到貨日期，前台排序要用到。
alter table products
  add column if not exists series_id uuid references product_series(id) on delete restrict;
alter table products
  add column if not exists estimated_arrival_date date;

create index if not exists products_series_id_idx on products(series_id);

-- 「加入預購清單」的 upsert：preorder_list_items 的唯一性語意是運算式
-- index（coalesce(variant_id, nil-uuid)），PostgREST 的 on_conflict 參數
-- 沒辦法對應運算式索引，所以用一支 RPC 把「查有沒有既有列 → 有就累加
-- 數量、沒有就新增」寫清楚，不是靠 supabase-js 的 .upsert()。
--
-- 不用 security definer：authenticated 角色本來就有 select/insert/update
-- 權限、RLS 也已經限制只能動自己的列（202610170001），這支函式不需要
-- 繞過 RLS，用預設的 security invoker 就夠、風險也更低。
create or replace function add_to_preorder_list(
  p_product_id uuid,
  p_variant_id uuid default null,
  p_quantity integer default 1
)
returns jsonb
language plpgsql
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
