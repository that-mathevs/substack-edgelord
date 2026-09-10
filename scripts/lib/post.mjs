// Shared helpers: Substack HTML -> Markdown, frontmatter, and file writing.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, extname } from 'node:path';
import { join } from 'node:path';
import TurndownService from 'turndown';
import site from '../../site.config.mjs';

export const POSTS_DIR = new URL('../../src/content/posts/', import.meta.url).pathname;
export const IMAGES_DIR = new URL('../../public/images/', import.meta.url).pathname;

const td = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
  emDelimiter: '*',
  hr: '---',
});

// Substack chrome that has no place in a mirror: subscribe/share widgets, buttons, polls.
td.addRule('substackWidgets', {
  filter: (node) =>
    /^(DIV|P|FORM)$/.test(node.nodeName) &&
    /subscription-widget|button-wrapper|poll-embed|community-modal|subscribe-widget|digest-post-embed/.test(
      node.getAttribute?.('class') ?? '',
    ),
  replacement: () => '',
});

// <figure> (Substack wraps images in figure > a > picture > img, + figcaption).
td.addRule('figure', {
  filter: 'figure',
  replacement: (_content, node) => {
    const img = node.querySelector('img');
    if (!img) return '';
    const src = img.getAttribute('src') ?? '';
    const caption = (node.querySelector('figcaption')?.textContent ?? img.getAttribute('alt') ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    const safeSrc = /[\s()]/.test(src) ? `<${src}>` : src;
    return `\n\n![${caption.replace(/[\[\]]/g, '')}](${safeSrc})\n\n`;
  },
});

// Substack image links: <a class="image-link"> wrapping a picture -- drop the link, keep the image.
td.addRule('imageLink', {
  filter: (node) => node.nodeName === 'A' && /image-link/.test(node.getAttribute('class') ?? ''),
  replacement: (content) => content,
});

// Substack footnotes -> GFM footnotes (Astro's markdown renders [^n] natively).
//   in text:   <a class="footnote-anchor" href="#footnote-1">1</a>
//   at bottom: <div class="footnote"><a class="footnote-number">1</a><div class="footnote-content"><p>..</p></div></div>
td.addRule('footnoteAnchor', {
  filter: (node) => node.nodeName === 'A' && /footnote-anchor/.test(node.getAttribute('class') ?? ''),
  replacement: (content) => `[^${content.trim()}]`,
});
td.addRule('footnote', {
  filter: (node) => node.nodeName === 'DIV' && /^footnote$/.test((node.getAttribute('class') ?? '').trim()),
  replacement: (_content, node) => {
    const n = node.querySelector('.footnote-number')?.textContent?.trim();
    const body = node.querySelector('.footnote-content');
    if (!n || !body) return '';
    const md = td.turndown(body.innerHTML).trim().replace(/\n/g, '\n    ');
    return `\n\n[^${n}]: ${md}\n\n`;
  },
});

// YouTube embeds carry the id in a data attribute; emit a plain link.
td.addRule('youtube', {
  filter: (node) => node.nodeName === 'DIV' && /youtube-wrap/.test(node.getAttribute('class') ?? ''),
  replacement: (_content, node) => {
    try {
      const { videoId } = JSON.parse(node.getAttribute('data-attrs') ?? '{}');
      return videoId ? `\n\n[Watch on YouTube](https://www.youtube.com/watch?v=${videoId})\n\n` : '';
    } catch {
      return '';
    }
  },
});

// Embedded tweets/iframes: keep raw HTML rather than lose them (markdown allows inline HTML).
td.keep(['iframe']);

export function htmlToMarkdown(html) {
  return td
    .turndown(html)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function slugFromUrl(url) {
  return new URL(url).pathname.split('/').filter(Boolean).pop() ?? '';
}

export function canonicalFor(slug) {
  return `${site.substack}/p/${slug}`;
}

/** Substack's feed ships titles/subtitles with straight quotes; the body uses typographic ones. Match them. */
function smartQuotes(text) {
  return String(text ?? '')
    .replace(/(\w)'(\w)/g, '$1\u2019$2')
    .replace(/(^|\s)"(\S)/g, '$1\u201c$2')
    .replace(/(\S)"(\s|$|[.,;:!?])/g, '$1\u201d$2');
}

function yamlString(value) {
  // JSON string literals are valid double-quoted YAML scalars.
  return JSON.stringify(String(value ?? ''));
}

export function toMarkdownFile({ title, date, slug, canonical, excerpt, markdown, updated, sourceHash }) {
  const iso = new Date(date).toISOString();
  const frontmatter = [
    '---',
    `title: ${yamlString(smartQuotes(title))}`,
    `date: ${iso}`,
    updated ? `updated: ${new Date(updated).toISOString()}` : null,
    `slug: ${yamlString(slug)}`,
    `canonical: ${yamlString(canonical)}`,
    `excerpt: ${yamlString(smartQuotes(excerpt))}`,
    sourceHash ? `sourceHash: ${yamlString(sourceHash)}` : null,
    '---',
  ].filter(Boolean).join('\n');
  return `${frontmatter}\n\n${markdown}\n`;
}

const SUBSTACK_IMAGE = /^https:\/\/(substackcdn\.com\/image\/fetch\/|substack-post-media\.s3\.amazonaws\.com\/)/;
const EXT_BY_TYPE = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'image/avif': '.avif', 'image/svg+xml': '.svg' };

/** Resolve a substackcdn "fetch" URL to the original S3 URL it wraps (or return the URL unchanged). */
function originalImageUrl(url) {
  const i = url.lastIndexOf('/https%3A');
  if (url.startsWith('https://substackcdn.com/image/fetch/') && i !== -1) {
    try { return decodeURIComponent(url.slice(i + 1)); } catch { /* fall through */ }
  }
  return url;
}

/**
 * Download every Substack-hosted image referenced in the markdown into public/images and rewrite
 * the references to local paths. On any failure the original URL is kept, so a post never breaks.
 */
export async function vendorImages(markdown) {
  const refs = [...markdown.matchAll(/!\[[^\]]*\]\(<?(https:\/\/[^\s)>]+)>?\)/g)]
    .map((m) => m[1])
    .filter((u) => SUBSTACK_IMAGE.test(u));
  if (refs.length === 0) return markdown;
  mkdirSync(IMAGES_DIR, { recursive: true });

  let out = markdown;
  for (const url of new Set(refs)) {
    const original = originalImageUrl(url);
    const stem = basename(new URL(original).pathname).replace(/\.[a-z0-9]+$/i, '');
    const existing = ['.png', '.jpg', '.gif', '.webp', '.avif', '.svg']
      .map((e) => stem + e)
      .find((f) => existsSync(IMAGES_DIR + f));
    let file = existing;
    if (!file) {
      try {
        const res = await fetch(original, { headers: { accept: 'image/*' } });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const type = (res.headers.get('content-type') ?? '').split(';')[0].trim();
        const ext = EXT_BY_TYPE[type] ?? extname(new URL(original).pathname) ?? '.bin';
        file = stem + ext;
        writeFileSync(IMAGES_DIR + file, Buffer.from(await res.arrayBuffer()));
        console.log(`  image ${file}`);
      } catch (err) {
        console.warn(`  image download failed, keeping remote URL: ${original} (${err.message})`);
        continue;
      }
    }
    out = out.split(url).join(`/images/${file}`);
  }
  return out;
}

export const hashSource = (html) => createHash('sha256').update(html).digest('hex').slice(0, 16);

function readFrontmatter(file) {
  const text = readFileSync(file, 'utf8');
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  const out = {};
  for (const line of (m?.[1] ?? '').split('\n')) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].replace(/^"(.*)"$/, '$1');
  }
  return out;
}

/**
 * Writes the post. Substack is the source of truth: a post is rewritten whenever the HTML in the
 * feed differs from what was last mirrored (tracked by sourceHash in frontmatter). Returns
 * 'created', 'updated', or false when nothing changed. `force` rewrites regardless.
 */
export async function writePost(post, { force = false } = {}) {
  mkdirSync(POSTS_DIR, { recursive: true });
  const file = join(POSTS_DIR, `${post.slug}.md`);
  const sourceHash = hashSource(post.html);
  let status = 'created';
  let updated;

  if (existsSync(file)) {
    const prev = readFrontmatter(file);
    if (!force && prev.sourceHash === sourceHash) return false;
    // A file with no hash predates hash tracking: adopt it without marking it edited.
    status = prev.sourceHash ? 'updated' : 'adopted';
    updated = prev.sourceHash && !force ? new Date() : prev.updated;
  }

  const md = await vendorImages(htmlToMarkdown(post.html));
  writeFileSync(file, toMarkdownFile({ ...post, markdown: md, updated, sourceHash }));
  return status;
}
