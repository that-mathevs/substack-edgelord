// Cloudflare Worker: fetches the Substack RSS feed on behalf of GitHub Actions.
// Two reasons it exists:
//   1. Substack returns 403 to GitHub's runner IPs. It answers Cloudflare fine.
//   2. Substack's CDN caches /feed for up to an hour. A unique query string bypasses that.
// Deploy from the dashboard (Workers & Pages -> Create -> Hello World -> paste this),
// then set the Worker URL as the FEED_URL repository variable on GitHub.
const FEED = 'https://example.substack.com/feed';

export default {
  async fetch() {
    const upstream = await fetch(`${FEED}?t=${Date.now()}`, {
      headers: { 'user-agent': 'substack-edgelord-sync' },
      cf: { cacheTtl: 0 },
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
