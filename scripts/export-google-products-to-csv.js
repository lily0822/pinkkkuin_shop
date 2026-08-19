const fs = require('fs');
const path = require('path');

const GOOGLE_API_URL = 'https://script.google.com/macros/s/AKfycbyC48NPyP1ookWXtJAiV9TAUO05rLcroNAF_Bd9GrNDHWCaTF4YrbKmKzT-mHpI-a7Fgw/exec';
const LOCAL_IMAGES_DIR = path.join(process.cwd(), 'public', 'images');
const LOCAL_IMAGE_EXTENSIONS = new Set(['.avif', '.gif', '.jpeg', '.jpg', '.png', '.svg', '.webp']);

function csvEscape(value) {
  const text = value === null || value === undefined ? '' : String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function normalizeActive(value) {
  if (value === false || value === 'false' || value === 'FALSE' || value === '0' || value === '下架') return 'draft';
  return 'active';
}

function normalizeVariants(product) {
  if (Array.isArray(product.variants) && product.variants.length) return product.variants;
  if (product.variantsJson) {
    try {
      const parsed = JSON.parse(product.variantsJson);
      if (Array.isArray(parsed) && parsed.length) return parsed;
    } catch {}
  }

  const price = Number(product.listPrice || product.price || 0);
  const quantity = Number(product.quantity || product.quota || 0);
  return [{
    id: `${product.id || product.name}-1`,
    spec: '預設款',
    price,
    quantity,
    link: ''
  }];
}

function normalizeLocalImage(value, productName) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(raw)) {
    throw new Error(`${productName || 'Product'} image must use public/images, not a URL: ${raw}`);
  }

  const withoutQuery = raw.replace(/[?#].*$/, '').replace(/\\/g, '/');
  const relative = withoutQuery.replace(/^\/?images\//i, '').replace(/^\/+/, '');
  if (!relative || path.isAbsolute(relative) || relative.split('/').includes('..')) {
    throw new Error(`${productName || 'Product'} image must be a file inside public/images: ${raw}`);
  }

  const extension = path.extname(relative).toLowerCase();
  if (!LOCAL_IMAGE_EXTENSIONS.has(extension)) {
    throw new Error(`${productName || 'Product'} image has an unsupported file type: ${raw}`);
  }

  const absolutePath = path.resolve(LOCAL_IMAGES_DIR, relative);
  const imageRoot = path.resolve(LOCAL_IMAGES_DIR);
  if (absolutePath !== imageRoot && !absolutePath.startsWith(`${imageRoot}${path.sep}`)) {
    throw new Error(`${productName || 'Product'} image must stay inside public/images: ${raw}`);
  }
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    throw new Error(`${productName || 'Product'} image file does not exist: public/images/${relative}`);
  }

  return relative;
}

function productToRow(product, productType, tagMap) {
  const tagIds = Array.isArray(product.tagIds) ? product.tagIds : [];
  const categoryNames = tagIds
    .map(id => tagMap.get(String(id)))
    .filter(Boolean);

  return {
    id: product.id || '',
    product_type: productType,
    name: product.name || '',
    description: product.description || '',
    image: normalizeLocalImage(product.image, product.name),
    costPrice: product.costPrice || '',
    listPrice: product.listPrice || product.price || '',
    quantity: product.quantity || product.quota || 0,
    deadline: product.deadline || '',
    status: normalizeActive(product.active),
    categories: categoryNames.length ? categoryNames.join('|') : '未分類',
    variants: JSON.stringify(normalizeVariants(product))
  };
}

async function main() {
  const response = await fetch(GOOGLE_API_URL);
  if (!response.ok) throw new Error(`Google API failed: ${response.status}`);
  const data = await response.json();

  const tagMap = new Map((data.productTags || []).map(tag => [String(tag.id), tag.name]));
  const rows = [
    ...(data.stockProducts || []).map(product => productToRow(product, 'stock', tagMap)),
    ...(data.preorderProducts || []).map(product => productToRow(product, 'preorder', tagMap))
  ];

  const headers = [
    'id',
    'product_type',
    'name',
    'description',
    'image',
    'costPrice',
    'listPrice',
    'quantity',
    'deadline',
    'status',
    'categories',
    'variants'
  ];

  const csv = [
    headers.join(','),
    ...rows.map(row => headers.map(header => csvEscape(row[header])).join(','))
  ].join('\n');

  const outputDir = path.join(process.cwd(), 'import');
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'products.csv'), csv);
  console.log(`Exported ${rows.length} products to import/products.csv`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
