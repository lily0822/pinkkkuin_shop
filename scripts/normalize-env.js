const fs = require('fs');

const envPath = '.env';
const text = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
const keys = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'DATABASE_URL'
];

let normalized = text.replace(/\r\n/g, '\n').trim();
for (const key of keys) {
  normalized = normalized.replace(new RegExp(`\\s+(${key}=)`, 'g'), '\n$1');
}
normalized = normalized
  .split('\n')
  .map(line => line.trim())
  .filter(Boolean)
  .join('\n') + '\n';
fs.writeFileSync(envPath, normalized);
console.log('Normalized .env keys onto separate lines.');
