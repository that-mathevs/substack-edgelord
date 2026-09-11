// Cloudflare Worker: fetches the Substack RSS feed on behalf of GitHub Actions.
// Why it exists:
//   1. Substack returns 403 to GitHub's runner IPs. It answers Cloudflare fine.
//   2. Substack's CDN caches /feed for up to an hour. A unique query string bypasses that.
//   3. Substack rate-limits those fresh fetches (429) for minutes at a time. This Worker keeps the
//      last good copy of the feed and serves it, marked x-feed-stale, when Substack is throttling.
// The sync script sends ?t=<timestamp> when it wants a fresh copy and nothing when the CDN copy is fine.
//
// Deploy from the dashboard (Workers & Pages -> Create -> Hello World -> paste this), then set the
// Worker URL as the FEED_URL repository variable on GitHub. NOTE: the last-good-copy cache only works
// when the Worker is served on a custom domain (e.g. feed.example.com); on *.workers.dev the Cache
// API is a no-op and rate-limited hours are simply skipped by the sync script.
const FEED = 'https://example.substack.com/feed';
const LAST_GOOD = new Request('https://feed-proxy.internal/last-good');
const HEADERS = { 'content-type': 'application/rss+xml; charset=utf-8', 'cache-control': 'no-store' };

export default {
  async fetch(request, _env, ctx) {
    const t = new URL(request.url).searchParams.get('t');
    let upstream = null;
    try {
      upstream = await fetch(t ? `${FEED}?t=${encodeURIComponent(t)}` : FEED, {
        headers: { 'user-agent': 'substack-edgelord-sync' },
        cf: { cacheTtl: t ? 0 : 300 },
      });
    } catch { /* network error: fall through to the stale copy */ }

    if (upstream?.ok) {
      const body = await upstream.text();
      ctx.waitUntil(caches.default.put(LAST_GOOD, new Response(body, {
        headers: { 'content-type': HEADERS['content-type'], 'cache-control': 'public, max-age=604800' },
      })));
      return new Response(body, { status: 200, headers: HEADERS });
    }

    const stale = await caches.default.match(LAST_GOOD);
    if (stale) return new Response(await stale.text(), { status: 200, headers: { ...HEADERS, 'x-feed-stale': '1' } });
    return new Response(upstream ? await upstream.text() : 'upstream unreachable', { status: upstream?.status ?? 502, headers: HEADERS });
  },
};
