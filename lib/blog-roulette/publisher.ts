import { uploadBlogAsGoogleDoc, shareBlogWithMarketing } from './google-drive';

/**
 * Helper to award a "Knowledge Badge" and 100 points to the author in the leaderboard.
 */
export async function awardBadgeAndPoints(userId: string, supabase: any) {
  // Try to find an existing leaderboard entry for the user
  const { data: entry } = await supabase
    .from('roulette_leaderboard')
    .select('*')
    .eq('user_id', userId)
    .single();

  const pointsToAdd = 100;
  const badgeName = 'Knowledge Badge';

  if (entry) {
    // Append the badge name if they don't already have it
    const updatedBadges = [...new Set([...(entry.badges || []), badgeName])];
    
    const { error } = await supabase
      .from('roulette_leaderboard')
      .update({
        points: (entry.points || 0) + pointsToAdd,
        badges: updatedBadges,
        last_blog_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId);

    if (error) {
      console.error('[publisher] Failed to update leaderboard:', error);
      throw error;
    }
  } else {
    // Create new entry
    const { error } = await supabase
      .from('roulette_leaderboard')
      .insert({
        user_id: userId,
        points: pointsToAdd,
        badges: [badgeName],
        last_blog_at: new Date().toISOString()
      });

    if (error) {
      console.error('[publisher] Failed to insert leaderboard:', error);
      throw error;
    }
  }
}

/**
 * Executes the publishing pipeline for a blog post:
 * 1. Fetches blog details.
 * 2. Sets blog status to 'PUBLISHING'.
 * 3. Uploads the blog body as a native Google Doc and shares it with marketing.
 * 4. Awards Knowledge Badge and 100 points to the author in the leaderboard.
 * 5. Logs success transaction metadata to roulette_publish_logs.
 * 6. Marks status as 'PUBLISHED' with the real Drive link (or rolls back to
 *    'PUBLISH_FAILED' on error).
 */
export async function runPublishPipeline(
  blogId: string,
  supabase: any,
  triggeringUserEmail: string
) {
  // 1. Fetch blog details
  const { data: blog, error: fetchError } = await supabase
    .from('roulette_blogs')
    .select('*')
    .eq('id', blogId)
    .single();

  if (fetchError || !blog) {
    throw new Error(fetchError?.message || 'Blog not found');
  }

  // 2. Mark status as PUBLISHING in the database
  await supabase
    .from('roulette_blogs')
    .update({ status: 'PUBLISHING' })
    .eq('id', blogId);

  try {
    // 3. Upload blog content to Drive as a native Google Doc and share it
    console.log(`[publisher] Uploading blog ${blogId} to Google Drive...`);
    const { fileId, webViewLink } = await uploadBlogAsGoogleDoc(
      { title: blog.title, slug: blog.slug },
      triggeringUserEmail,
      blog.body_html || ''
    );
    const sharedEmails = await shareBlogWithMarketing(fileId, triggeringUserEmail);

    // 3b. Award Knowledge Badge and points to the author
    console.log(`[publisher] Awarding Knowledge Badge and points to user ${blog.author_id}...`);
    await awardBadgeAndPoints(blog.author_id, supabase);

    // 4. Log success in roulette_publish_logs
    await supabase.from('roulette_publish_logs').insert({
      blog_id: blogId,
      drive_file_id: fileId,
      drive_url: webViewLink,
      recipients: sharedEmails,
      status: 'success',
      published_at: new Date().toISOString(),
    });

    // 5. Finalize blog status as PUBLISHED
    await supabase
      .from('roulette_blogs')
      .update({
        status: 'PUBLISHED',
        published_at: new Date().toISOString(),
        drive_url: webViewLink,
        drive_file_id: fileId,
      })
      .eq('id', blogId);

    console.log(`[publisher] Blog ${blogId} published directly & badges awarded.`);
    return { success: true, fileId, webViewLink };
  } catch (err: any) {
    console.error(`[publisher] Publishing pipeline failed for blog ${blogId}:`, err);

    // Log failure log in roulette_publish_logs
    await supabase.from('roulette_publish_logs').insert({
      blog_id: blogId,
      status: 'failed',
      error_message: err.message || 'Unknown publishing pipeline error',
    });

    // Transition blog status to PUBLISH_FAILED for retry
    await supabase
      .from('roulette_blogs')
      .update({ status: 'PUBLISH_FAILED' })
      .eq('id', blogId);

    throw err;
  }
}
