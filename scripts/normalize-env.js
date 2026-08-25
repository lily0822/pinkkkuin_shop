const fs = require('fs');

const envPath = '.env';
if (!fs.existsSync(envPath)) {
  console.log('.env not found. Nothing to normalize.');
  process.exit(0);
}

const text = fs.readFileSync(envPath, 'utf8');
const normalized = text
  .replace(/\r\n/g, '\n')
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .join('\n') + '\n';

fs.writeFileSync(envPath, normalized);
console.log('Normalized .env formatting only. .env.local was not modified.');
