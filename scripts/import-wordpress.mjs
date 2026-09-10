#!/usr/bin/env node
// Import published posts from a WordPress site via its REST API into src/content/posts.
//
//   node scripts/import-wordpress.mjs https://example.com [--skip slug,slug] [--insecure] [--force]
//
// --skip      comma-separated slugs to leave out (e.g. posts already mirrored from elsewhere)
// --insecure  accept an expired/invalid TLS certificate on the source site
// --force     rewrite posts even when the source HTML hasn't changed
// --no-source make posts canonical to this site and drop the link back to the source

import { writePost } from './lib/post.mjs';
import site from '../site.config.mjs';

const args = process.argv.slice(2);
const base = args.find((a) => /^https?:\/\//.test(a))?.replace(/\/$/, '');
const skip = new Set((args[args.indexOf('--skip') + 1] ?? '').split(',').filter(Boolean));
if (args.includes('--insecure')) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const force = args.includes('--force');
const noSource = args.includes('--no-source');
if (!base) { console.error('usage: node scripts/import-wordpress.mjs https://site [--skip a,b] [--insecure] [--force]'); process.exit(1); }

const decode = (s) => String(s ?? '')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&hellip;/g, '\u2026').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#039;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** WordPress auto-excerpts are the first ~55 words plus an ellipsis; keep the first sentence or two. */
function excerptOf(post) {
  let t = decode(post.excerpt?.rendered ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const title = decode(post.title.rendered).trim();
  if (t.startsWith(title)) t = t.slice(title.length).trim();
  t = t.replace(/\s*\[?\u2026\]?\s*$/, '');
  // Sentence ends: terminal punctuation followed by a space and a capital, but not after an initial ("D. John").
  const ends = [...t.matchAll(/[.!?]+(?=\s+[A-Z"\u201c])/g)].map((m) => m.index + m[0].length).filter((i) => !/(^|\s)[A-Z]\.$/.test(t.slice(0, i)));
  let out = '';
  for (const i of ends) { if (i > 180) break; out = t.slice(0, i); }
  return (out || t.slice(0, 180)).trim();
}

let page = 1, written = 0, skipped = 0, unchanged = 0;
for (;;) {
  const res = await fetch(`${base}/wp-json/wp/v2/posts?status=publish&per_page=100&page=${page}`, { headers: { 'user-agent': 'Mozilla/5.0 (substack-edgelord import)' } });
  if (res.status === 400) break; // past the last page
  if (!res.ok) { console.error(`fetch failed: ${res.status} ${res.statusText}`); process.exit(1); }
  const posts = await res.json();
  if (posts.length === 0) break;
  for (const post of posts) {
    if (skip.has(post.slug)) { skipped++; console.log(`skip    ${post.slug}`); continue; }
    const status = await writePost({
      title: decode(post.title.rendered),
      date: `${post.date_gmt}Z`,
      slug: post.slug,
      canonical: noSource ? `${site.site}/p/${post.slug}` : post.link,
      excerpt: excerptOf(post),
      html: noSource ? post.content.rendered.replaceAll(base, site.site.replace(/\/$/, '') + '/p').replace(/\/p\/([a-z0-9-]+)\/(?=["'])/g, '/p/$1') : post.content.rendered,
    }, { force });
    if (status) { written++; console.log(`${status} ${post.slug}.md`); } else unchanged++;
  }
  page++;
}
console.log(`done: ${written} written, ${unchanged} unchanged, ${skipped} skipped`);
