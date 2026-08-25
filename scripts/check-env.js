const fs = require('fs');

const envFiles = ['.env', '.env.local'];
const keys = [
  'APP_ENV',
  'SUPABASE_ENV',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'DATABASE_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'
];

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return { exists: false, values: {} };
  const text = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return { exists: true, values };
}

const loaded = envFiles.map((file) => ({ file, ...readEnvFile(file) }));
const merged = Object.assign({}, ...loaded.map((entry) => entry.values), process.env);
const target = String(merged.SUPABASE_ENV || merged.APP_ENV || '').trim().toLowerCase();
const label = target === 'production'
  ? 'PRODUCTION'
  : target === 'staging' || target === 'development'
    ? 'STAGING'
    : 'UNKNOWN';

console.log(`Supabase environment: ${label}`);
if (label === 'UNKNOWN') {
  console.log('Set SUPABASE_ENV=staging in .env.local for localhost. Use SUPABASE_ENV=production only with explicit production commands.');
}

for (const entry of loaded) {
  console.log(`${entry.file}: ${entry.exists ? 'found' : 'missing'}`);
}

for (const key of keys) {
  const sources = loaded
    .filter((entry) => Object.prototype.hasOwnProperty.call(entry.values, key))
    .map((entry) => `${entry.file}:${entry.values[key] ? 'set' : 'empty'}`);
  console.log(`${key}: ${sources.length ? sources.join(', ') : 'missing'}`);
}
