// Everything site-specific lives here. Change these and nothing else.
export default {
  title: 'My Newsletter',
  description: 'One sentence about what this newsletter is.',
  author: 'Your Name',
  site: 'https://example.com',                 // where the mirror is served
  substack: 'https://example.substack.com',    // the newsletter being mirrored
  personal: 'https://example.com/about',       // author URL for structured data (optional)
  sameAs: [],                                  // other profile URLs for structured data (optional)
  // true: every page is canonical to this site so it can rank on its own.
  // false: canonical points at the Substack original.
  selfCanonical: true,
};
