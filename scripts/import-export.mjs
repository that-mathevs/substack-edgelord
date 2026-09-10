#!/usr/bin/env node
// Convert a Substack export (the .zip from Settings -> Exports, or its unzipped folder)
// into markdown posts under src/content/posts.
//
//   node scripts/import-export.mjs path/to/export.zip [--force]
//   node scripts/import-export.mjs path/to/export-folder [--force]
//
// Posts are rewritten when the export HTML differs from what was last mirrored; --force rewrites all.

import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { canonicalFor, writePost } from './lib/post.mjs';

const args = process.argv.slice(2);
const force = args.includes('--force');
const input = args.find((a) => !a.startsWith('--'));

if (!input || !existsSync(input)) {
  console.error('usage: node scripts/import-export.mjs <export.zip | export-dir> [--force]');
  process.exit(1);
}

let dir = input;
if (statSync(input).isFile()) {
  dir = mkdtempSync(join(tmpdir(), 'substack-export-'));
  execFileSync('unzip', ['-q', '-o', input, '-d', dir]);
}

const csvPath = join(dir, 'posts.csv');
if (!existsSync(csvPath)) {
  console.error(`posts.csv not found in ${dir}`);
  process.exit(1);
}

// Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, newlines inside quotes).
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows.filter((r) => r.length > 1);
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), r[i] ?? ''])));
}

const rows = parseCsv(readFileSync(csvPath, 'utf8'));
let written = 0, skipped = 0, missing = 0;

for (const row of rows) {
  if (row.is_published !== 'true') continue;
  const postId = row.post_id; // e.g. "123456.my-post-slug"
  const slug = postId.replace(/^\d+\./, '');
  const htmlPath = join(dir, 'posts', `${postId}.html`);
  if (!existsSync(htmlPath)) { missing++; console.warn(`missing html: ${htmlPath}`); continue; }

  const status = await writePost(
    {
      title: row.title,
      date: row.post_date,
      slug,
      canonical: canonicalFor(slug),
      excerpt: row.subtitle,
      html: readFileSync(htmlPath, 'utf8'),
    },
    { force },
  );
  if (status) { written++; console.log(`${status} ${slug}.md`); } else skipped++;
}

console.log(`done: ${written} written, ${skipped} skipped (unchanged), ${missing} missing html`);
