// Verifies every translation has the same keys and interpolation placeholders
// as its en.json source, across every app that ships locales. Generalized from
// the zh-only check in the TShentu/famlin fork's web/scripts/check-zh.mjs.
//
// Usage: node scripts/check-locales.mjs   (or `npm run check:locales`)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCALE_DIRS = [
  'backend/src/i18n/locales',
  'backend/admin/src/i18n/locales',
  'web/src/i18n/locales',
  'mobile/src/i18n/locales',
];

function flatten(object, prefix = '') {
  return Object.entries(object).flatMap(([key, value]) =>
    value !== null && typeof value === 'object'
      ? flatten(value, `${prefix}${key}.`)
      : [[`${prefix}${key}`, value]],
  );
}

function placeholders(value) {
  return [...String(value).matchAll(/{{\s*([^}]+?)\s*}}/g)].map((m) => m[1]).sort().join(',');
}

function load(file) {
  return Object.fromEntries(flatten(JSON.parse(fs.readFileSync(file, 'utf8'))));
}

const problems = [];
for (const dir of LOCALE_DIRS) {
  const abs = path.join(root, dir);
  const source = load(path.join(abs, 'en.json'));
  const languages = fs.readdirSync(abs).filter((f) => f.endsWith('.json') && f !== 'en.json');
  for (const file of languages) {
    const label = `${dir}/${file}`;
    const translated = load(path.join(abs, file));
    for (const key of Object.keys(source)) {
      if (!(key in translated)) problems.push(`${label}: missing "${key}"`);
      else if (typeof translated[key] !== 'string' || !translated[key].trim()) problems.push(`${label}: empty "${key}"`);
      else if (placeholders(translated[key]) !== placeholders(source[key])) {
        problems.push(`${label}: placeholder mismatch in "${key}"`);
      }
    }
    for (const key of Object.keys(translated)) {
      if (!(key in source)) problems.push(`${label}: extra key "${key}" not in en.json`);
    }
    console.log(`${label}: ${Object.keys(translated).length} keys checked`);
  }
}

if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
