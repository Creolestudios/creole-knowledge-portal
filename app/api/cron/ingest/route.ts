import { NextResponse } from 'next/server';
import { scrapeFeeds } from '@/lib/ingestion/scraper';
import { processWithLLM } from '@/lib/ingestion/llm-processor';
import { createClient } from '@/lib/supabase/server';

// Optional: Validate cron secret if using Vercel Cron
// const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(request: Request) {
  // Basic auth check for the cron job (if configured)
  const authHeader = request.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabase = await createClient();
    console.log('Starting ingestion process...');

    // 1. Scrape RSS feeds
    const scrapedItems = await scrapeFeeds();
    console.log(`Scraped ${scrapedItems.length} items.`);

    let processedCount = 0;
    let insertedCount = 0;

    // 2. Process each item
    for (const item of scrapedItems) {
      // Check if URL already exists to save LLM calls
      const { data: existing } = await supabase
        .from('blogs')
        .select('id')
        .eq('url', item.url)
        .single();

      if (existing) {
        continue; // Skip if we already have it
      }

      // Process with LLM
      const processed = await processWithLLM(item.title, item.content);
      processedCount++;

      if (processed.isRelevant) {
        // Insert into Supabase
        const { error } = await supabase.from('blogs').insert({
          title: item.title,
          url: item.url,
          content: item.content, // Optionally truncate this to save DB space
          source: item.source,
          summary: processed.summary,
          tags: processed.tags,
          author: item.author,
          published_at: item.publishedAt,
        });

        if (error) {
          console.error('Error inserting blog:', error);
        } else {
          insertedCount++;
        }
      }
    }

    console.log(`Ingestion complete. Processed: ${processedCount}, Inserted: ${insertedCount}`);
    return NextResponse.json({
      success: true,
      scraped: scrapedItems.length,
      processed: processedCount,
      inserted: insertedCount,
    });
  } catch (error) {
    console.error('Ingestion failed:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
