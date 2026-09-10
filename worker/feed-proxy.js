// Cloudflare Worker: fetches the Substack RSS feed on behalf of GitHub Actions.
// Two reasons it exists:
//   1. Substack returns 403 to GitHub's runner IPs. It answers Cloudflare fine.
//   2. Substack's CDN caches /feed for up to an hour. A unique query string bypasses that.
// The sync script decides: it sends ?t=<timestamp> when it wants a fresh copy (Substack may
// answer 429 to those) and no query string when the CDN-cached copy is acceptable.
// Deploy from the dashboard (Workers & Pages -> Create -> Hello World -> paste this),
// then set the Worker URL as the FEED_URL repository variable on GitHub.
const FEED = 'https://example.substack.com/feed';

export default {
  async fetch(request) {
    const t = new URL(request.url).searchParams.get('t');
    const upstream = await fetch(t ? `${FEED}?t=${encodeURIComponent(t)}` : FEED, {
      headers: { 'user-agent': 'substack-edgelord-sync' },
      cf: { cacheTtl: t ? 0 : 300 },
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        'content-type': 'application/rss+xml; charset=utf-8',
        'cache-control': 'no-store',
      },
    });
  },
};
