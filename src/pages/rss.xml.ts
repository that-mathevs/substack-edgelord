import rss from '@astrojs/rss';
import { getCollection, render } from 'astro:content';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import type { APIContext } from 'astro';
import site from '../../site.config.mjs';

export async function GET(context: APIContext) {
  const posts = (await getCollection('posts')).sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
  const container = await AstroContainer.create();
  const items = [];
  for (const post of posts) {
    const { Content } = await render(post);
    const html = (await container.renderToString(Content)).replace(/(src|href)="\//g, `$1="${site.site}/`);
    items.push({
      title: post.data.title,
      description: post.data.excerpt,
      pubDate: post.data.date,
      link: `/p/${post.data.slug}`,
      author: site.author,
      content: html,
    });
  }
  return rss({ title: site.title, description: site.description, site: context.site!, items, customData: '<language>en-us</language>' });
}
