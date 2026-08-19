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
    if (value || process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv(path.join(process.cwd(), '.env'));

const url = process.env.SUPABASE_URL || '';
const anonKey = process.env.SUPABASE_ANON_KEY || '';

if (!url || !anonKey) {
  console.warn('SUPABASE_URL or SUPABASE_ANON_KEY is missing. Generated disabled Supabase config.');
}

const content = `window.SHOP_SUPABASE_CONFIG = ${JSON.stringify({ url, anonKey }, null, 2)};\n`;
fs.writeFileSync(path.join(process.cwd(), 'public', 'shop-env.js'), content);
fs.writeFileSync(path.join(process.cwd(), 'shop-env.js'), content);
console.log('Generated shop-env.js from environment variables.');
