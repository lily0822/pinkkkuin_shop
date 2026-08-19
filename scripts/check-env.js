const fs = require('fs');

const envPath = '.env';
const text = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
const keys = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'DATABASE_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'
];

for (const key of keys) {
  const matches = [...text.matchAll(new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`, 'gm'))];
  if (!matches.length) {
    console.log(`${key}: 找不到`);
    continue;
  }
  const details = matches.map(match => {
    const lineNo = text.slice(0, match.index).split(/\r?\n/).length;
    return `第${lineNo}行${match[1].trim() ? '已填' : '空白'}`;
  }).join('、');
  console.log(`${key}: ${details}`);
}
