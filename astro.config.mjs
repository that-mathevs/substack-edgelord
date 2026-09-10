import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import site from './site.config.mjs';

export default defineConfig({
  site: site.site,
  output: 'static',
  trailingSlash: 'never',
  build: { format: 'file' },
  integrations: [sitemap()],
});
