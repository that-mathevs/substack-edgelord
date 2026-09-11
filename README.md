# substack-edgelord

Mirror a Substack newsletter to your own domain as a pure static site, served from Cloudflare's edge.
No server, no database, no CMS. Substack stays the editor and the mailing list. Git is the archive.

**How it works**

1. A GitHub Action runs hourly, fetches the newsletter's RSS feed, converts each post's HTML to
   markdown, and commits anything new or changed. Substack wins: edits there propagate here.
2. The commit triggers a Cloudflare build. Astro renders the markdown to HTML. Cloudflare serves
   `dist/` as static assets on a Worker.
3. Substack blocks GitHub's runner IPs, so the feed is fetched through a ten-line Cloudflare Worker.
   The Worker also cache-busts the request, because Substack's CDN serves a stale `/feed` for up to an hour.

## Setup

**1. Configure.** Edit `site.config.mjs`. That is the only file with site-specific values.

**2. Backfill (optional).** Substack → Settings → Exports. Then:

```bash
npm install
npm run import -- ~/Downloads/export.zip
npm run build
```

The RSS feed only carries the ~20 most recent posts; the export has everything.

**3. Feed proxy.** In Cloudflare: Workers & Pages → Create → Hello World. Paste `worker/feed-proxy.js`,
set `FEED` to your newsletter's `/feed` URL, deploy. Copy the Worker URL. Optional but recommended:
give the Worker a custom domain (Settings → Domains & Routes) so it can keep a last-good copy of the
feed for the minutes when Substack rate-limits; the Cache API is a no-op on `*.workers.dev`.

**4. GitHub.** Push this repo. Under Settings → Secrets and variables → Actions → Variables, add
`FEED_URL` with the Worker URL. The sync workflow runs at :17 every hour, or on demand. Until that
variable exists the workflow skips itself, so a fresh fork doesn't fail every hour.

**5. Deploy.** In Cloudflare: Workers & Pages → Create → Workers → Import a repository. Cloudflare
detects Astro, runs `npm run build`, and deploys with `npx wrangler deploy` using `wrangler.jsonc`.

**6. Domain.** Add your domain as a Cloudflare zone, delete any leftover A/CNAME records for the
hostname, then uncomment the `routes` block in `wrangler.jsonc` and push. The next deploy binds it.

## Layout

| Path | What |
| --- | --- |
| `site.config.mjs` | Title, author, URLs, canonical policy |
| `src/content/posts/*.md` | Mirrored posts. Frontmatter: `title`, `date`, `slug`, `canonical`, `excerpt`, `updated`, `sourceHash` |
| `scripts/sync-rss.mjs` | Hourly sync from RSS |
| `scripts/import-export.mjs` | One-time backfill from a Substack export |
| `scripts/import-wordpress.mjs` | Backfill from a WordPress site's REST API |
| `scripts/lib/post.mjs` | HTML → markdown (Turndown + Substack cleanup rules), image vendoring, change detection |
| `worker/feed-proxy.js` | Cloudflare Worker that fetches the feed for CI |
| `.github/workflows/sync.yml` | The cron |
| `wrangler.jsonc` | Cloudflare deploy config |

## What the converter does

- Strips Substack's subscribe widgets, share buttons, and polls.
- Turns `<figure>` blocks into markdown images with captions.
- Converts Substack footnotes into GFM footnotes that render.
- Downloads images into `public/images` and rewrites references, so posts survive CDN changes.
- Smartens straight quotes in titles and subtitles.
- Hashes the source HTML into `sourceHash`; a changed hash rewrites the file and stamps `updated`.

## SEO

- `selfCanonical: true` makes every page canonical to your domain so it can rank. Set `false` to point
  canonicals at Substack instead.
- JSON-LD `WebSite` and `BlogPosting`, Open Graph and Twitter meta, `article:published_time` and
  `article:modified_time`, sitemap, and a full-content RSS feed.

MIT.
