// Cloudflare Worker: fetches the Substack RSS feed on behalf of GitHub Actions.
// Substack returns 403 to GitHub's runner IPs; it answers Cloudflare fine.
// Deploy from the dashboard (Workers & Pages -> Create -> Hello World -> paste this),
// then set the Worker URL as the FEED_URL repository variable on GitHub.
const FEED = 'https://example.substack.com/feed';

export default {
  async fetch() {
    const upstream = await fetch(FEED, {
      headers: { 'user-agent': 'substack-edgelord-sync' },
      cf: { cacheTtl: 300 },
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        'content-type': 'application/rss+xml; charset=utf-8',
        'cache-control': 'public, max-age=300',
      },
    });
  },
};
