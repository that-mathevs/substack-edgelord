import site from '../../site.config.mjs';

export const person = {
  '@type': 'Person',
  '@id': `${site.site}/#author`,
  name: site.author,
  url: site.personal || site.site,
  sameAs: site.sameAs,
};

export const website = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  '@id': `${site.site}/#website`,
  url: site.site,
  name: site.title,
  description: site.description,
  author: person,
};

export function blogPosting(p: { title: string; description: string; url: string; date: Date; updated?: Date; wordCount: number; substackUrl: string }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    mainEntityOfPage: { '@type': 'WebPage', '@id': p.url },
    headline: p.title,
    description: p.description,
    datePublished: p.date.toISOString(),
    dateModified: (p.updated ?? p.date).toISOString(),
    author: person,
    wordCount: p.wordCount,
    isPartOf: { '@id': `${site.site}/#website` },
    sameAs: p.substackUrl,
  };
}
