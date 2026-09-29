// Links a LINE Rich Menu to ONE specific user, instead of publishing it as
// the default menu for all 1,546+ friends on the real Official Account.
// Safe for pre-launch testing: only the given LINE user id will see the menu.
//
// Usage:
//   node scripts/line-link-rich-menu-to-user.js <richMenuId> <lineUserId>
//
// Requires LINE_CHANNEL_ACCESS_TOKEN in .env / .env.local / process.env
// (same token src/lib/line/client.ts already uses for push/reply).
//
// To remove the test link later (so that user falls back to whatever
// default menu is set, or none):
//   node scripts/line-link-rich-menu-to-user.js --unlink <lineUserId>

const fs = require('fs');

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const text = fs.readFileSync(filePath, 'utf8').replace(/^﻿/, '');
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
  return values;
}

const merged = Object.assign({}, readEnvFile('.env'), readEnvFile('.env.local'), process.env);
const token = merged.LINE_CHANNEL_ACCESS_TOKEN;

if (!token) {
  console.error('Missing LINE_CHANNEL_ACCESS_TOKEN (checked .env, .env.local, process.env).');
  process.exit(1);
}

async function linkRichMenuToUser(userId, richMenuId) {
  const res = await fetch(`https://api.line.me/v2/bot/user/${encodeURIComponent(userId)}/richmenu/${encodeURIComponent(richMenuId)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`LINE API ${res.status}: ${await res.text()}`);
  console.log(`Linked rich menu ${richMenuId} to user ${userId}.`);
}

async function unlinkRichMenuFromUser(userId) {
  const res = await fetch(`https://api.line.me/v2/bot/user/${encodeURIComponent(userId)}/richmenu`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`LINE API ${res.status}: ${await res.text()}`);
  console.log(`Unlinked any rich menu from user ${userId}.`);
}

const args = process.argv.slice(2);

if (args[0] === '--unlink') {
  const userId = args[1];
  if (!userId) {
    console.error('Usage: node scripts/line-link-rich-menu-to-user.js --unlink <lineUserId>');
    process.exit(1);
  }
  unlinkRichMenuFromUser(userId).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
} else {
  const [richMenuId, userId] = args;
  if (!richMenuId || !userId) {
    console.error('Usage: node scripts/line-link-rich-menu-to-user.js <richMenuId> <lineUserId>');
    process.exit(1);
  }
  linkRichMenuToUser(userId, richMenuId).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
