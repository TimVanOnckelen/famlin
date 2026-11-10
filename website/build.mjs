#!/usr/bin/env node
// Builds the famlin.app landing page in every language.
//
//   node website/build.mjs [outDir]     (default: website/dist)
//
// Templates live in website/src/ (one per page); the text lives in
// website/locales/<lang>.json, in i18next JSON format, one object per page.
// The first entry of languages.json is the default language and is built at
// the site root; every other language is built under /<code>/.
//
// Placeholders in templates:
//   {{t:page.key}}          a translated string (falls back to the default language)
//   {{lang}}                the page's language code
//   {{root}}                "/" or "/<code>/", for links to other pages of this site
//   {{alternates}}          <link rel="alternate" hreflang> tags for every language
//   {{langswitch:compact}}  the language switcher in the home page's nav
//   {{langswitch:inline}}   the language switcher with inline styles (privacy, support)
// Translated strings may contain HTML and {{root}}.
//
// No dependencies, so it runs anywhere Node 20+ does.

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = 'https://famlin.app';
const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(process.argv[2] ?? join(here, 'dist'));
const STATIC = ['assets', 'favicon.ico', 'CNAME'];

const languages = JSON.parse(readFileSync(join(here, 'languages.json'), 'utf8'));
const defaultLang = languages[0].code;
const prefix = (code) => (code === defaultLang ? '' : `${code}/`);
const locales = Object.fromEntries(
  languages.map(({ code }) => [code, JSON.parse(readFileSync(join(here, 'locales', `${code}.json`), 'utf8'))]),
);

function listTemplates(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return listTemplates(path);
    return name.endsWith('.html') ? [path] : [];
  });
}

// "support/index.html" -> "support/", "index.html" -> ""
const pagePath = (rel) => rel.replace(/index\.html$/, '');

const missing = new Map();
const errors = new Set();

function translate(lang, key, page) {
  const [section, ...rest] = key.split('.');
  const name = rest.join('.');
  const value = locales[lang][section]?.[name];
  if (value !== undefined && value !== '') return value;
  const fallback = locales[defaultLang][section]?.[name];
  if (fallback === undefined) {
    errors.add(`${page}: unknown key "${key}"`);
    return '';
  }
  if (!missing.has(lang)) missing.set(lang, new Set());
  missing.get(lang).add(key);
  return fallback;
}

function langSwitch(style, lang, path) {
  const sep = style === 'compact' ? '<span aria-hidden="true">·</span>' : '<span style="color:#c3d2d8;">·</span>';
  const items = languages.map(({ code, label }) => {
    if (code === lang) {
      return style === 'compact'
        ? `<span aria-current="true">${label}</span>`
        : `<span style="padding:6px 8px;color:#006e94;" aria-current="true">${label}</span>`;
    }
    const href = `/${prefix(code)}${path}`;
    return style === 'compact'
      ? `<a href="${href}" hreflang="${code}" lang="${code}">${label}</a>`
      : `<a href="${href}" hreflang="${code}" lang="${code}" style="padding:6px 8px;color:#597784;font-weight:800;">${label}</a>`;
  });
  return items.join(style === 'compact' ? sep : `\n        ${sep}\n        `);
}

function alternates(path) {
  const tags = languages.map(
    ({ code }) => `<link rel="alternate" hreflang="${code}" href="${SITE}/${prefix(code)}${path}">`,
  );
  tags.push(`<link rel="alternate" hreflang="x-default" href="${SITE}/${path}">`);
  return tags.join('\n');
}

function render(template, lang, rel) {
  const path = pagePath(rel);
  const root = `/${prefix(lang)}`;
  return template
    .replace(/\{\{t:([\w.-]+)\}\}/g, (_, key) => translate(lang, key, rel))
    .replaceAll('{{lang}}', lang)
    .replaceAll('{{root}}', root)
    .replaceAll('{{alternates}}', alternates(path))
    .replace(/\{\{langswitch:(compact|inline)\}\}/g, (_, style) => langSwitch(style, lang, path));
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
for (const item of STATIC) {
  const from = join(here, item);
  if (existsSync(from)) cpSync(from, join(outDir, item), { recursive: true });
}

const srcDir = join(here, 'src');
let written = 0;
for (const file of listTemplates(srcDir)) {
  const rel = relative(srcDir, file).split('\\').join('/');
  const template = readFileSync(file, 'utf8');
  for (const { code } of languages) {
    const html = render(template, code, rel);
    const leftover = html.match(/\{\{[^}]*\}\}/);
    if (leftover) errors.add(`${code}/${rel}: unresolved placeholder ${leftover[0]}`);
    const dest = join(outDir, prefix(code), rel);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, html);
    written++;
  }
}

for (const [lang, keys] of missing) {
  console.warn(`${lang}: ${keys.size} string(s) not translated yet, using ${defaultLang}: ${[...keys].join(', ')}`);
}
if (errors.size) {
  console.error([...errors].join('\n'));
  process.exit(1);
}
console.log(`Built ${written} pages in ${languages.length} languages into ${relative(process.cwd(), outDir) || '.'}`);
