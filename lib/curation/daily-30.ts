import { createClient } from '@/lib/supabase/server';

export interface Daily30Item {
  id: string;
  blog_id: string;
  curated_date: string;
  display_order: number;
  curation_notes: string | null;
  blogs: {
    title: string;
    url: string;
    source: string;
    summary: string;
    tags: string[];
    author: string;
    published_at: string;
  };
}

/**
 * Retrieves the Daily 30 curated items for a specific date, or the latest available.
 */
export async function getDaily30(dateStr?: string): Promise<Daily30Item[]> {
  const supabase = await createClient();

  let queryDate = dateStr;

  // If no date provided, find the most recent curation date
  if (!queryDate) {
    const { data: latestCuration } = await supabase
      .from('daily_30_curation')
      .select('curated_date')
      .order('curated_date', { ascending: false })
      .limit(1)
      .single();

    if (latestCuration) {
      queryDate = latestCuration.curated_date;
    } else {
      return []; // No curations exist yet
    }
  }

  const { data, error } = await supabase
    .from('daily_30_curation')
    .select(
      `
            id,
            blog_id,
            curated_date,
            display_order,
            curation_notes,
            blogs (
                title,
                url,
                source,
                summary,
                tags,
                author,
                published_at
            )
        `
    )
    .eq('curated_date', queryDate)
    .order('display_order', { ascending: true });

  if (error) {
    console.error('Error fetching Daily 30:', error);
    return [];
  }

  // Cast the nested join data properly
  return data as unknown as Daily30Item[];
}
