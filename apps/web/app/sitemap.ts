import type { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  return ['', 'privacy', 'terms', 'llms.txt', 'llms-full.txt'].map(path => ({
    url: `https://mangmeeplus.com/${path}`,
  }));
}
