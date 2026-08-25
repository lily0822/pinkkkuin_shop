const fs = require('fs');
const path = require('path');

const GOOGLE_API_URL = 'https://script.google.com/macros/s/AKfycbyC48NPyP1ookWXtJAiV9TAUO05rLcroNAF_Bd9GrNDHWCaTF4YrbKmKzT-mHpI-a7Fgw/exec';

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
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

function slugify(value) {
  const slug = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '-')
    .replace(/^-+|-+$/g, '');
  return slug || `category-${Date.now()}`;
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

  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function upsert(table, payload, conflict = 'legacy_id') {
  if (!payload || (Array.isArray(payload) && payload.length === 0)) return [];
  return supabaseRequest(`${table}?on_conflict=${conflict}`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

function num(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
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

async function main() {
  loadDotEnv(path.join(process.cwd(), '.env'));
  loadDotEnv(path.join(process.cwd(), '.env.local'));
  assertSafeSupabaseTarget('import-backend-data');
  const response = await fetch(GOOGLE_API_URL);
  if (!response.ok) throw new Error(`Google API failed: ${response.status}`);
  const data = await response.json();

  await upsert('vendors', (data.vendors || []).map(vendor => ({
    legacy_id: String(vendor.id),
    name: vendor.name || '',
    contact: vendor.contact || '',
    location: vendor.location || '',
    currency: vendor.currency || '',
    notes: vendor.notes || ''
  })));

  await upsert('websites', (data.websites || []).map(website => ({
    legacy_id: String(website.id),
    name: website.name || '',
    contact: website.contact || '',
    location: website.location || '',
    currency: website.currency || '',
    link: website.link || '',
    notes: website.notes || ''
  })));

  await upsert('backend_orders', (data.orders || []).map(order => ({
    legacy_id: String(order.id),
    date: order.date || '',
    vendor_id: order.vendorId === undefined || order.vendorId === null ? '' : String(order.vendorId),
    order_no: order.orderNo || '',
    tracking_no: order.trackingNo || '',
    shipped: order.shipped || '',
    shipped_date: order.shippedDate || '',
    items: Array.isArray(order.items) ? order.items : []
  })));

  await upsert('categories', (data.productTags || []).map(tag => ({
    legacy_id: String(tag.id),
    name: tag.name || '',
    slug: slugify(tag.name),
    color: tag.color || '#ec4899',
    type: tag.type === 'ip' ? 'ip' : 'category',
    enabled: tag.enabled !== false,
    sort_order: num(tag.sortOrder ?? tag.sort_order)
  })));

  await upsert('stall_schedules', (data.stallSchedules || []).map(schedule => ({
    legacy_id: String(schedule.id),
    period: schedule.period || '',
    location: schedule.location || '',
    image: schedule.image || '',
    stall_fee: num(schedule.stallFee),
    days: Array.isArray(schedule.days) ? schedule.days : []
  })));

  await upsert('connection_schedules', (data.connectionSchedules || []).map(schedule => ({
    legacy_id: String(schedule.id),
    period: schedule.period || '',
    location: schedule.location || '',
    image: schedule.image || '',
    start_date: schedule.startDate || null,
    end_date: schedule.endDate || null,
    flight_fee: num(schedule.flightFee),
    hotel_fee: num(schedule.hotelFee)
  })));

  await upsert('schedule_settings', (data.scheduleSettings || []).map(setting => ({
    legacy_id: String(setting.id || setting.type),
    type: String(setting.type || setting.id || 'default'),
    image: setting.image || ''
  })), 'type');

  console.log('Imported backend management data into Supabase.');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
