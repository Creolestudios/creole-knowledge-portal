import Parser from 'rss-parser';
import * as cheerio from 'cheerio';

const parser = new Parser({
  customFields: {
    item: [
      ['content:encoded', 'contentEncoded'],
      ['creator', 'author'],
    ],
  },
});

export interface ScrapedBlog {
  title: string;
  url: string;
  content: string;
  source: string;
  author: string | null;
  publishedAt: string;
}

export const FEED_SOURCES = [
  { name: 'Netflix TechBlog', url: 'https://netflixtechblog.com/feed' },
  { name: 'Uber Engineering', url: 'https://www.uber.com/en-IN/blog/engineering/rss/' },
  { name: 'InfoQ Architecture', url: 'https://feed.infoq.com/architecture/news' },
];

/**
 * Strips HTML tags from content using cheerio
 */
function stripHtml(html: string): string {
  if (!html) return '';
  const $ = cheerio.load(html);
  return $.root().text().replace(/\s+/g, ' ').trim();
}

/**
 * Scrapes all configured RSS feeds
 */
export async function scrapeFeeds(): Promise<ScrapedBlog[]> {
  const allBlogs: ScrapedBlog[] = [];

  for (const source of FEED_SOURCES) {
    try {
      console.log(`Fetching RSS feed for ${source.name}...`);
      const feed = await parser.parseURL(source.url);

      for (const item of feed.items) {
        // Ensure we have the minimum required data
        if (!item.title || !item.link) {
          continue;
        }

        const contentHtml = item.contentEncoded || item.content || item.summary || '';
        const plainContent = stripHtml(contentHtml);

        // Only include if there is some substantive content
        if (plainContent.length > 100) {
          allBlogs.push({
            title: item.title,
            url: item.link,
            content: plainContent,
            source: source.name,
            author: item.creator || item.author || null,
            publishedAt: item.isoDate || item.pubDate || new Date().toISOString(),
          });
        }
      }
    } catch (error) {
      console.error(`Error fetching feed from ${source.name}:`, error);
      // We continue processing other feeds even if one fails
    }
  }

  return allBlogs;
}
