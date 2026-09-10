#!/usr/bin/env node
// Fetch the Substack RSS feed and mirror it into src/content/posts. Substack wins: new posts are
// written, and posts whose HTML changed since the last sync are rewritten. Run hourly by sync.yml.

import { appendFileSync } from 'node:fs';
import { slugFromUrl, writePost } from './lib/post.mjs';
import site from '../site.config.mjs';

// Substack blocks GitHub runner IPs, so CI fetches via a Cloudflare Worker proxy (FEED_URL env var).
const FEED_URL = process.env.FEED_URL || `${site.substack}/feed`;

// Substack occasionally answers 429 to the proxy; retry a few times with backoff before giving up.
async function fetchFeed(attempts = 4) {
  let last;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 15_000 * i));
    // Substack's CDN caches /feed for up to an hour; a unique query string forces a fresh copy.
    const url = new URL(FEED_URL);
    url.searchParams.set('t', Date.now().toString());
    const res = await fetch(url, {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; substack-edgelord; +' + site.site + ')' },
    });
    if (res.ok) return res.text();
    last = `${res.status} ${res.statusText}`;
    console.warn(`feed fetch attempt ${i + 1}/${attempts} failed: ${last}`);
    if (res.status < 429) break; // 4xx other than 429 won't improve with retries
  }
  console.error(`feed fetch failed: ${last}`);
  process.exit(1);
}

const xml = await fetchFeed();

const decode = (s) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

/** Extract a child element's text from an <item>, unwrapping CDATA or decoding XML entities. */
function field(item, tag) {
  const m = item.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`));
  if (!m) return '';
  const raw = m[1].trim();
  const cdata = raw.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/);
  return cdata ? cdata[1] : decode(raw);
}

const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
let written = 0;
const newSlugs = [];

for (const item of items) {
  const link = field(item, 'link');
  if (!link) continue;
  const slug = slugFromUrl(link);
  const html = field(item, 'content:encoded');
  if (!html) continue; // paywalled posts ship without a body; nothing to mirror

  const status = await writePost({
    title: field(item, 'title'),
    date: field(item, 'pubDate'),
    slug,
    canonical: link,
    excerpt: field(item, 'description'),
    html,
  });
  if (status) { written++; newSlugs.push(slug); console.log(`${status} ${slug}.md`); }
}

console.log(`feed had ${items.length} item(s); ${written} post(s) written or updated`);
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `written=${written}\nslugs=${newSlugs.join(' ')}\n`);
}
