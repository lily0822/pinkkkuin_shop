const fs = require('fs');
const path = require('path');

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      value += '"';
      i++;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(value);
      value = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i++;
      row.push(value);
      if (row.some(cell => cell.trim() !== '')) rows.push(row);
      row = [];
      value = '';
      continue;
    }

    value += char;
  }

  row.push(value);
  if (row.some(cell => cell.trim() !== '')) rows.push(row);
  return rows;
}

function normalizeHeader(header) {
  return String(header || '').trim().toLowerCase();
}

function pick(row, names, fallback = '') {
  for (const name of names) {
    if (row[name] !== undefined && row[name] !== null && String(row[name]).trim() !== '') {
      return String(row[name]).trim();
    }
  }
  return fallback;
}

function toNumber(value, fallback = 0) {
  const cleaned = String(value ?? '')
    .replace(/[,\s]/g, '')
    .replace(/nt\$|ntd|twd|\$/gi, '');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toInteger(value, fallback = 0) {
  return Math.trunc(toNumber(value, fallback));
}

function slugify(value) {
  const slug = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '-')
    .replace(/^-+|-+$/g, '');
  return slug || `category-${Date.now()}`;
}

function normalizeStatus(value, quantity) {
  const raw = String(value || '').trim().toLowerCase();
  if (['active', '上架', 'true', '1', 'yes', '啟用'].includes(raw)) return 'active';
  if (['sold_out', 'sold out', '售完', '完售', '缺貨'].includes(raw)) return 'sold_out';
  if (['draft', '下架', 'false', '0', 'no', '草稿'].includes(raw)) return 'draft';
  if (quantity <= 0) return 'sold_out';
  return 'active';
}

function splitList(value) {
  return String(value || '')
    .split(/[|/、，,]/)
    .map(item => item.trim())
    .filter(Boolean);
}

const LOCAL_IMAGES_DIR = path.join(process.cwd(), 'public', 'images');
const LOCAL_IMAGE_EXTENSIONS = new Set(['.avif', '.gif', '.jpeg', '.jpg', '.png', '.svg', '.webp']);

function normalizeLocalImage(value, productName) {
  const raw = String(value || '').trim();
  if (!raw) return null;

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

  return `/images/${relative}`;
}

function parseVariants(row, product) {
  const variantsJson = pick(row, ['variants', 'variantsjson', '規格明細'], '');
  if (variantsJson) {
    try {
      const parsed = JSON.parse(variantsJson);
      if (Array.isArray(parsed) && parsed.length) {
        return parsed.map((variant, index) => ({
          legacy_id: String(variant.id || `${product.legacy_id || product.name}-${index + 1}`),
          sku: String(variant.sku || ''),
          spec: String(variant.spec || variant.name || '預設款').trim(),
          price: toNumber(variant.price, product.base_price),
          stock_quantity: toInteger(variant.quantity ?? variant.qty, product.stock_quantity),
          product_url: String(variant.link || variant.product_url || '').trim(),
          status: normalizeStatus(variant.status, toInteger(variant.quantity ?? variant.qty, product.stock_quantity)),
          sort_order: index
        }));
      }
    } catch (error) {
      console.warn('Cannot parse variants JSON, fallback to single variant:', error.message);
    }
  }

  return [{
    legacy_id: `${product.legacy_id || product.name}-1`,
    sku: pick(row, ['sku', '編號'], ''),
    spec: pick(row, ['spec', '規格'], '預設款'),
    price: product.base_price,
    stock_quantity: product.stock_quantity,
    product_url: pick(row, ['link', 'product_url', '商品連結'], ''),
    status: product.status,
    sort_order: 0
  }];
}

async function supabaseRequest(pathname, options = {}) {
  const url = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');

  const response = await fetch(`${url}/rest/v1/${pathname}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation',
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const message = await response.text().catch(() => '');
    throw new Error(`Supabase ${options.method || 'GET'} ${pathname} failed (${response.status}): ${message}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

async function upsertCategory(name) {
  const payload = {
    name,
    slug: slugify(name)
  };
  const rows = await supabaseRequest('categories?on_conflict=slug', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  return rows[0];
}

async function upsertProduct(product) {
  const rows = await supabaseRequest('products?on_conflict=legacy_id', {
    method: 'POST',
    body: JSON.stringify(product)
  });
  return rows[0];
}

async function replaceProductLinks(productId, categories, variants) {
  await supabaseRequest(`product_categories?product_id=eq.${productId}`, { method: 'DELETE' });
  if (categories.length) {
    await supabaseRequest('product_categories', {
      method: 'POST',
      body: JSON.stringify(categories.map(category => ({
        product_id: productId,
        category_id: category.id
      })))
    });
  }

  await supabaseRequest(`product_variants?product_id=eq.${productId}`, { method: 'DELETE' });
  if (variants.length) {
    await supabaseRequest('product_variants', {
      method: 'POST',
      body: JSON.stringify(variants.map(variant => ({
        ...variant,
        product_id: productId
      })))
    });
  }
}

async function main() {
  loadDotEnv(path.join(process.cwd(), '.env'));
  loadDotEnv(path.join(process.cwd(), '.env.local'));
  assertSafeSupabaseTarget('import-products');

  const validateOnly = process.argv.includes('--validate-local-images');
  const csvArg = process.argv.find(arg => arg.endsWith('.csv'));
  const csvPath = csvArg || path.join(process.cwd(), 'import', 'products.csv');
  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV not found: ${csvPath}`);
  }

  const parsed = parseCsv(fs.readFileSync(csvPath, 'utf8'));
  const headers = parsed[0].map(normalizeHeader);
  const records = parsed.slice(1).map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] || ''])));

  let imported = 0;
  for (const row of records) {
    const quantity = toInteger(pick(row, ['quantity', 'stock_quantity', '庫存', '數量'], '0'));
    const productType = pick(row, ['product_type', 'type', '商品類型'], 'stock') === 'preorder' ? 'preorder' : 'stock';
    const productName = pick(row, ['name', '商品名稱']);
    const product = {
      legacy_id: pick(row, ['id', 'legacy_id', '商品id'], ''),
      product_type: productType,
      name: productName,
      description: pick(row, ['description', 'desc', '商品描述'], null),
      image_url: normalizeLocalImage(pick(row, ['image', 'image_url', '圖片', '圖片url'], null), productName),
      cost_price: toNumber(pick(row, ['costprice', 'cost_price', '成本價'], '0')),
      base_price: toNumber(pick(row, ['listprice', 'price', 'base_price', '定價', '價格'], '0')),
      stock_quantity: quantity,
      preorder_quota: toInteger(pick(row, ['quota', 'preorder_quota', '名額', '預購數量'], '0')),
      deadline: pick(row, ['deadline', '結單時間', '結單日期'], null) || null,
      status: normalizeStatus(pick(row, ['status', 'active', '狀態'], ''), quantity),
      source: 'csv_import'
    };

    if (!product.name) {
      console.warn('Skipped row without product name.');
      continue;
    }
    if (!product.legacy_id) product.legacy_id = `${product.product_type}-${slugify(product.name)}`;

    if (validateOnly) {
      imported++;
      continue;
    }

    const categoryNames = splitList(pick(row, ['categories', 'category', 'tags', 'tagids', '標籤', '分類'], '未分類'));
    const categories = [];
    for (const name of categoryNames.length ? categoryNames : ['未分類']) {
      categories.push(await upsertCategory(name));
    }

    const savedProduct = await upsertProduct(product);
    const variants = parseVariants(row, product);
    await replaceProductLinks(savedProduct.id, categories, variants);
    imported++;
  }

  if (validateOnly) {
    console.log(`Validated ${imported} products. Images are local files in public/images.`);
    return;
  }

  console.log(`Imported ${imported} products into Supabase.`);
}

function assertSafeSupabaseTarget(scriptName) {
  const allowProduction = process.argv.includes('--allow-production');
  const target = String(process.env.SUPABASE_ENV || process.env.APP_ENV || '').trim().toLowerCase();

  if (allowProduction) {
    if (target !== 'production') {
      throw new Error(`${scriptName}: --allow-production also requires SUPABASE_ENV=production or APP_ENV=production.`);
    }
    console.warn(`${scriptName}: PRODUCTION import explicitly enabled.`);
    return;
  }

  if (target !== 'staging' && target !== 'development') {
    throw new Error(`${scriptName}: refusing to write Supabase. Set SUPABASE_ENV=staging for local/staging imports. Production requires SUPABASE_ENV=production and --allow-production.`);
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(`${scriptName}: missing staging SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.`);
  }

  console.log(`${scriptName}: Supabase target ${target.toUpperCase()}.`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
