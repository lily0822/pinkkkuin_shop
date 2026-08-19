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
  category: string;
  brand?: string;
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
  created_at: string;
  updated_at: string;
};

export const statusLabels: Record<ProductStatus, string> = {
  in_stock: "現貨",
  preorder: "預購",
  live_order: "連線商品",
  sold_out: "售完",
  restocking: "補貨中",
  hidden: "暫停販售",
};

export const statusStyles: Record<ProductStatus, string> = {
  in_stock: "bg-emerald-100 text-emerald-700",
  preorder: "bg-pink-100 text-pink-700",
  live_order: "bg-sky-100 text-sky-700",
  sold_out: "bg-stone-200 text-stone-600",
  restocking: "bg-amber-100 text-amber-700",
  hidden: "bg-zinc-200 text-zinc-600",
};

export const categories = [
  "ちいかわ",
  "ナガノキャラクターズ",
  "Sanrio",
  "Disney",
  "Pokémon",
  "Pikmin",
  "其他日本雜貨",
];

export const products: Product[] = [
  {
    id: "1",
    name_zh: "ちいかわ 垂耳兔兔吊飾",
    name_jp: "ちいかわ 垂れ耳なうさぎマスコット",
    sku: "4582662920262",
    price: 390,
    status: "in_stock",
    category: "ちいかわ",
    brand: "ちいかわ",
    stock_quantity: 3,
    images: ["/images/sample-1.svg"],
    description: "可愛的垂耳兔兔吊飾，日本官方商品，適合掛在包包或鑰匙圈上。",
    size: "約 H10cm",
    material: "聚酯纖維",
    source: "日本官方商店",
    notice: "日本商品可能有初始小瑕疵，完美主義者請斟酌。",
    is_featured: true,
    sort_order: 1,
    created_at: "2026-05-01T09:00:00+08:00",
    updated_at: "2026-05-01T09:00:00+08:00",
  },
  {
    id: "2",
    name_zh: "公主造型小八吊飾",
    name_jp: "プーワッパ プリンセスなマスコット（ハチワレ）",
    sku: "4571609391982",
    price: 560,
    status: "preorder",
    category: "ちいかわ",
    brand: "ちいかわ",
    stock_quantity: null,
    images: ["/images/sample-2.svg"],
    description: "公主造型系列吊飾，預購商品，造型甜甜又有收藏感。",
    size: "約 H12cm",
    material: "聚酯纖維",
    source: "日本官方商店",
    preorder_note: "預購約 15～30 天，不含特殊延遲。",
    notice: "預購成立後不接受任意取消。",
    is_featured: true,
    sort_order: 2,
    created_at: "2026-05-02T09:00:00+08:00",
    updated_at: "2026-05-02T09:00:00+08:00",
  },
  {
    id: "3",
    name_zh: "Sanrio 貼紙包",
    name_jp: "サンリオ キャラクターズ ステッカーセット",
    sku: "SR-0526",
    price: 180,
    status: "in_stock",
    category: "Sanrio",
    brand: "Sanrio",
    stock_quantity: 8,
    images: ["/images/sample-3.svg"],
    description: "手帳與卡片都適合的 Sanrio 貼紙包，多角色混款。",
    size: "約 9 x 12cm",
    material: "紙",
    source: "日本雜貨店",
    notice: "款式以現貨為準，可私訊確認細節。",
    is_featured: true,
    sort_order: 3,
    created_at: "2026-05-03T09:00:00+08:00",
    updated_at: "2026-05-03T09:00:00+08:00",
  },
  {
    id: "4",
    name_zh: "Pikmin 迷你收納袋",
    name_jp: "ピクミン ミニポーチ",
    sku: "PKM-1002",
    price: 420,
    status: "live_order",
    category: "Pikmin",
    brand: "Pikmin",
    stock_quantity: null,
    images: ["/images/sample-4.svg"],
    description: "日本連線商品，小尺寸收納袋可放耳機、零錢或小物。",
    size: "約 W12 x H9cm",
    material: "聚酯纖維",
    source: "日本實體店鋪",
    preorder_note: "連線商品以現場庫存為準，成功購入後約 15～30 天到貨。",
    notice: "若現場售完會協助退款或改單。",
    is_featured: true,
    sort_order: 4,
    created_at: "2026-05-04T09:00:00+08:00",
    updated_at: "2026-05-04T09:00:00+08:00",
  },
  {
    id: "5",
    name_zh: "Pokémon 透明資料夾",
    name_jp: "ポケモン A4 クリアファイル",
    sku: "PM-7721",
    price: 150,
    status: "restocking",
    category: "Pokémon",
    brand: "Pokémon",
    stock_quantity: 0,
    images: ["/images/sample-5.svg"],
    description: "A4 尺寸透明資料夾，適合收藏或日常文件分類。",
    size: "A4",
    material: "PP",
    source: "日本官方商店",
    notice: "補貨時間未定，可先私訊登記。",
    sort_order: 5,
    created_at: "2026-04-28T09:00:00+08:00",
    updated_at: "2026-05-03T09:00:00+08:00",
  },
  {
    id: "6",
    name_zh: "Disney 小熊吊飾",
    name_jp: "ディズニー ベアチャーム",
    sku: "DS-9910",
    price: 680,
    status: "sold_out",
    category: "Disney",
    brand: "Disney",
    stock_quantity: 0,
    images: ["/images/sample-6.svg"],
    description: "柔軟毛絨材質的小熊吊飾，適合收藏與送禮。",
    size: "約 H14cm",
    material: "聚酯纖維",
    source: "日本 Disney Store",
    notice: "目前售完，後續補貨請以公告為準。",
    sort_order: 6,
    created_at: "2026-04-20T09:00:00+08:00",
    updated_at: "2026-05-01T09:00:00+08:00",
  },
  {
    id: "7",
    name_zh: "ナガノ 角色便條紙",
    name_jp: "ナガノキャラクターズ メモパッド",
    sku: "NGN-024",
    price: 220,
    status: "preorder",
    category: "ナガノキャラクターズ",
    brand: "ナガノキャラクターズ",
    stock_quantity: null,
    images: ["/images/sample-7.svg"],
    description: "可愛插畫便條紙，適合手帳、禮物留言與收藏。",
    size: "約 8 x 8cm",
    material: "紙",
    source: "日本官方商店",
    preorder_note: "預購約 15～30 天，不含特殊延遲。",
    notice: "預購成立後不接受任意取消。",
    sort_order: 7,
    created_at: "2026-04-27T09:00:00+08:00",
    updated_at: "2026-05-02T09:00:00+08:00",
  },
  {
    id: "8",
    name_zh: "日本喫茶風迷你杯",
    name_jp: "喫茶風 ミニグラス",
    sku: "JP-ZK-88",
    price: 320,
    status: "in_stock",
    category: "其他日本雜貨",
    brand: "日本雜貨",
    stock_quantity: 5,
    images: ["/images/sample-8.svg"],
    description: "復古喫茶風小杯，適合甜點、飲品或桌面擺拍。",
    size: "約 120ml",
    material: "玻璃",
    source: "日本雜貨店",
    notice: "玻璃商品寄送會加強包裝，仍請開箱錄影。",
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
