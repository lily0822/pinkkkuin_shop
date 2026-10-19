export type ProductStatus =
  | "in_stock"
  | "preorder"
  | "live_order"
  | "sold_out"
  | "restocking"
  | "hidden";

export type Product = {
  id: string;
  name_zh: string;
  name_jp?: string;
  sku?: string;
  price: number;
  original_price?: number;
  status: ProductStatus;
  // 商品本身在資料庫的 product_type，跟 status／category 分開存——
  // status 會因為售完變成 "sold_out"、category 可能被商品類別標籤
  // 蓋掉，兩者都不是「這個商品本來是不是預購商品」的可靠判斷依據
  // （預購獨立流程 第三期的門禁判斷就是因為這個理由，改成一律讀這個
  // 欄位，不要用 status === "preorder" || category === "預購商品"
  // 這種容易漏判的 fallback 組合）。
  productType: "stock" | "preorder";
  category: string;
  brand?: string;
  tags?: ProductTag[];
  stock_quantity?: number | null;
  images: string[];
  description?: string;
  size?: string;
  material?: string;
  source?: string;
  preorder_note?: string;
  notice?: string;
  is_featured?: boolean;
  sort_order?: number;
  variants?: ProductVariant[];
  created_at: string;
  updated_at: string;
};

export type ProductVariant = {
  id: string;
  legacyId?: string;
  spec: string;
  price?: number | null;
  // 規格層級的特價劃線用原價（成本價是後台內部欄位，故意不放進這個前台
  // 共用型別，避免被任何前台頁面不小心讀到）。
  originalPrice?: number | null;
  stockQuantity?: number | null;
  productUrl?: string;
  // 這個規格專屬的圖片（product_images.variant_id 對得上才有值）；沒有
  // 專屬圖片就是 undefined，不在這個型別/資料層自己 fallback 成商品
  // 主圖——呼叫端（購物車、預購清單等）可能有自己的主圖來源，退回邏輯
  // 交給呼叫端決定。
  imageUrl?: string;
  status: "active" | "sold_out" | "draft";
  sortOrder: number;
};

// 多規格商品在卡片/快速預覽這種「還沒選規格」的場合，要挑一個規格代表整個
// 商品顯示價格（NT$最低價 起）。優先挑「上架中且有庫存」裡最便宜的；
// 都沒庫存就退而求其次挑「上架中」裡最便宜的；再沒有就直接挑全部規格裡
// 最便宜的——不會讓一個已下架/售完的規格價格決定卡片顯示，除非真的沒有
// 其他選擇。
export function pickDisplayVariant(variants: ProductVariant[] = []): ProductVariant | null {
  if (!variants.length) return null;
  const cheapest = (pool: ProductVariant[]) =>
    pool.reduce((min, variant) => (Number(variant.price ?? 0) < Number(min.price ?? 0) ? variant : min), pool[0]);
  const inStock = variants.filter((variant) => variant.status === "active" && Number(variant.stockQuantity ?? 0) > 0);
  if (inStock.length) return cheapest(inStock);
  const active = variants.filter((variant) => variant.status === "active");
  if (active.length) return cheapest(active);
  return cheapest(variants);
}

export type ProductTag = {
  id: string;
  name: string;
  type: "ip" | "category";
  enabled: boolean;
  sortOrder: number;
  color?: string;
};

export const statusLabels: Record<ProductStatus, string> = {
  in_stock: "現貨",
  preorder: "預購",
  live_order: "連線商品",
  sold_out: "缺貨",
  restocking: "補貨中",
  hidden: "隱藏",
};

export const statusStyles: Record<ProductStatus, string> = {
  in_stock: "bg-emerald-100 text-emerald-700",
  preorder: "bg-penguin-pink-light text-penguin-pink-dark",
  live_order: "bg-sky-100 text-sky-700",
  sold_out: "bg-stone-200 text-stone-600",
  restocking: "bg-amber-100 text-amber-700",
  hidden: "bg-zinc-200 text-zinc-600",
};

export const categories = [
  "Chiikawa",
  "角落生物",
  "Sanrio",
  "Disney",
  "Pokemon",
  "Pikmin",
  "日本雜貨",
];

export const products: Product[] = [
  {
    id: "1",
    name_zh: "Chiikawa 小八貓吊飾",
    name_jp: "ちいかわ ハチワレ マスコット",
    sku: "4582662920262",
    price: 390,
    status: "in_stock",
    productType: "stock",
    category: "Chiikawa",
    brand: "Chiikawa",
    stock_quantity: 3,
    images: ["/images/sample-1.svg"],
    description: "日本限定小八貓吊飾，柔軟蓬鬆，可掛在包包或鑰匙圈上。",
    size: "約 H10cm",
    material: "聚酯纖維",
    source: "日本官方商店",
    notice: "現貨商品數量有限，下單前可先私訊確認庫存。",
    is_featured: true,
    sort_order: 1,
    created_at: "2026-05-01T09:00:00+08:00",
    updated_at: "2026-05-01T09:00:00+08:00",
  },
  {
    id: "2",
    name_zh: "Chiikawa 兔兔趴姿娃娃",
    name_jp: "ちいかわ うさぎ ぬいぐるみ",
    sku: "4571609391982",
    price: 560,
    status: "preorder",
    productType: "preorder",
    category: "Chiikawa",
    brand: "Chiikawa",
    stock_quantity: null,
    images: ["/images/sample-2.svg"],
    description: "兔兔趴姿造型娃娃，表情可愛，適合放在桌上或床邊陪伴。",
    size: "約 H12cm",
    material: "絨毛、聚酯纖維",
    source: "日本官方商店",
    preorder_note: "預購商品約 15 到 30 個工作天寄回，實際到貨依日本出貨狀況為準。",
    notice: "預購商品不接受臨時取消，請確認後再下單。",
    is_featured: true,
    sort_order: 2,
    created_at: "2026-05-02T09:00:00+08:00",
    updated_at: "2026-05-02T09:00:00+08:00",
  },
  {
    id: "3",
    name_zh: "Sanrio 透明收納包",
    name_jp: "サンリオ クリアポーチ",
    sku: "SR-0526",
    price: 180,
    status: "in_stock",
    productType: "stock",
    category: "Sanrio",
    brand: "Sanrio",
    stock_quantity: 8,
    images: ["/images/sample-3.svg"],
    description: "透明材質收納包，可以放小卡、貼紙、化妝小物或票券。",
    size: "約 9 x 12cm",
    material: "PET",
    source: "日本雜貨店現貨",
    notice: "透明材質可能有些微刮痕，介意者請先詢問。",
    is_featured: true,
    sort_order: 3,
    created_at: "2026-05-03T09:00:00+08:00",
    updated_at: "2026-05-03T09:00:00+08:00",
  },
  {
    id: "4",
    name_zh: "Pikmin 小物零錢包",
    name_jp: "ピクミン ミニポーチ",
    sku: "PKM-1002",
    price: 420,
    status: "live_order",
    productType: "stock",
    category: "Pikmin",
    brand: "Pikmin",
    stock_quantity: null,
    images: ["/images/sample-4.svg"],
    description: "日本連線商品，適合收納零錢、耳機或小配件。",
    size: "約 W12 x H9cm",
    material: "棉、聚酯纖維",
    source: "日本連線店鋪",
    preorder_note: "連線商品需等日本現場確認庫存，追加約 15 到 30 個工作天。",
    notice: "連線商品數量變動快，請以回覆確認為準。",
    is_featured: true,
    sort_order: 4,
    created_at: "2026-05-04T09:00:00+08:00",
    updated_at: "2026-05-04T09:00:00+08:00",
  },
  {
    id: "5",
    name_zh: "Pokemon A4 文件夾",
    name_jp: "ポケモン A4 クリアファイル",
    sku: "PM-7721",
    price: 150,
    status: "restocking",
    productType: "stock",
    category: "Pokemon",
    brand: "Pokemon",
    stock_quantity: 0,
    images: ["/images/sample-5.svg"],
    description: "A4 尺寸文件夾，可收納資料、貼紙或明信片。",
    size: "A4",
    material: "PP",
    source: "日本官方商店",
    notice: "補貨中商品可先私訊登記，到貨會再通知。",
    sort_order: 5,
    created_at: "2026-04-28T09:00:00+08:00",
    updated_at: "2026-05-03T09:00:00+08:00",
  },
  {
    id: "6",
    name_zh: "Disney 米奇娃娃",
    name_jp: "ディズニー ミッキー ぬいぐるみ",
    sku: "DS-9910",
    price: 680,
    status: "sold_out",
    productType: "stock",
    category: "Disney",
    brand: "Disney",
    stock_quantity: 0,
    images: ["/images/sample-6.svg"],
    description: "經典米奇造型娃娃，柔軟好抱，適合收藏。",
    size: "約 H14cm",
    material: "棉、絨毛",
    source: "日本 Disney Store",
    notice: "此商品已售完，之後若補貨會另行公告。",
    sort_order: 6,
    created_at: "2026-04-20T09:00:00+08:00",
    updated_at: "2026-05-01T09:00:00+08:00",
  },
  {
    id: "7",
    name_zh: "角落生物造型鑰匙圈",
    name_jp: "すみっコぐらし キーホルダー",
    sku: "SG-024",
    price: 220,
    status: "preorder",
    productType: "preorder",
    category: "角落生物",
    brand: "角落生物",
    stock_quantity: null,
    images: ["/images/sample-7.svg"],
    description: "療癒角色造型鑰匙圈，可掛包包、筆袋或鑰匙。",
    size: "約 8 x 8cm",
    material: "PVC",
    source: "日本官方商店",
    preorder_note: "預購商品約 15 到 30 個工作天寄回。",
    notice: "預購商品不接受臨時取消，請確認後再下單。",
    sort_order: 7,
    created_at: "2026-04-27T09:00:00+08:00",
    updated_at: "2026-05-02T09:00:00+08:00",
  },
  {
    id: "8",
    name_zh: "日本雜貨花朵陶瓷杯",
    name_jp: "花柄 セラミックカップ",
    sku: "JP-ZK-88",
    price: 320,
    status: "in_stock",
    productType: "stock",
    category: "日本雜貨",
    brand: "日本雜貨",
    stock_quantity: 5,
    images: ["/images/sample-8.svg"],
    description: "小花圖案陶瓷杯，適合日常咖啡、茶飲或桌面擺設。",
    size: "約 120ml",
    material: "陶瓷",
    source: "日本雜貨店",
    notice: "陶瓷商品運送會加強包裝，但仍建議拆封時錄影確認。",
    sort_order: 8,
    created_at: "2026-04-26T09:00:00+08:00",
    updated_at: "2026-05-01T09:00:00+08:00",
  },
];

export function formatPrice(price: number) {
  return `NT$${price.toLocaleString("zh-TW")}`;
}

export function getProductById(id: string) {
  return products.find((product) => product.id === id);
}

export function getFeaturedProducts() {
  return products.filter((product) => product.is_featured && product.status !== "hidden");
}
