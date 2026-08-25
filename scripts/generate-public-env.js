const fs = require('fs');
const path = require('path');

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim().replace(/^\uFEFF/, '');
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function currentEnvironmentLabel() {
  const target = String(process.env.SUPABASE_ENV || process.env.APP_ENV || '').trim().toLowerCase();
  if (target === 'production') return 'PRODUCTION';
  if (target === 'staging' || target === 'development') return 'STAGING';
  return 'UNKNOWN';
}

loadDotEnv(path.join(process.cwd(), '.env'));
loadDotEnv(path.join(process.cwd(), '.env.local'));

const environmentLabel = currentEnvironmentLabel();
const allowProduction = process.argv.includes('--allow-production');

console.log(`Supabase public env target: ${environmentLabel}`);

if (environmentLabel === 'PRODUCTION' && !allowProduction) {
  throw new Error('Refusing to generate production public Supabase config without --allow-production.');
}

if (environmentLabel !== 'STAGING' && environmentLabel !== 'PRODUCTION') {
  throw new Error('Refusing to generate public Supabase config. Set SUPABASE_ENV=staging for local development.');
}

const url = process.env.SUPABASE_URL || '';
const anonKey = process.env.SUPABASE_ANON_KEY || '';

if (!url || !anonKey) {
  throw new Error('SUPABASE_URL or SUPABASE_ANON_KEY is missing.');
}

const content = `window.SHOP_SUPABASE_CONFIG = ${JSON.stringify({ url, anonKey }, null, 2)};\n`;
fs.writeFileSync(path.join(process.cwd(), 'public', 'shop-env.js'), content);
fs.writeFileSync(path.join(process.cwd(), 'shop-env.js'), content);
console.log('Generated shop-env.js from public Supabase environment variables.');
