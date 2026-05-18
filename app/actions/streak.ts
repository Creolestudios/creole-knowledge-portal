'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

export async function recordUserActivity(activityType: string, referenceId?: string) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    throw new Error('Unauthorized');
  }

  const userId = user.id;
  const today = new Date().toISOString().split('T')[0];

  // 1. Log the activity
  const { error: logError } = await supabase.from('user_activity_logs').insert({
    user_id: userId,
    activity_type: activityType,
    reference_id: referenceId,
  });

  if (logError) {
    console.error('Error logging activity:', logError);
    throw new Error('Failed to record activity');
  }

  // 2. Update the streak
  const { data: streakData, error: streakError } = await supabase
    .from('user_streaks')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (streakError && streakData === null) {
    // Initialize streak for new user
    const { error: initError } = await supabase.from('user_streaks').insert({
      user_id: userId,
      current_streak: 1,
      longest_streak: 1,
      last_activity_date: today,
      updated_at: new Date().toISOString(),
    });

    if (initError) throw new Error('Failed to initialize streak');
    revalidatePath('/dashboard');
    return { success: true };
  }

  if (streakError) {
    console.error('Error fetching streak:', streakError);
    throw new Error('Failed to update streak');
  }

  const lastDate = streakData?.last_activity_date;
  const lastDateObj = new Date(lastDate!);
  const todayObj = new Date(today);

  // Calculate difference in days
  const diffTime = todayObj.getTime() - lastDateObj.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

  let currentStreak = streakData!.current_streak;
  let longestStreak = streakData!.longest_streak;

  if (diffDays === 0) {
    // Same day: do nothing to streak count
  } else if (diffDays === 1) {
    // Consecutive day: increment
    currentStreak += 1;
  } else {
    // Gap: reset
    currentStreak = 1;
  }

  if (currentStreak > longestStreak) {
    longestStreak = currentStreak;
  }

  const { error: updateError } = await supabase
    .from('user_streaks')
    .update({
      current_streak: currentStreak,
      longest_streak: longestStreak,
      last_activity_date: today,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId);

  if (updateError) {
    console.error('Error updating streak:', updateError);
    throw new Error('Failed to update streak');
  }

  revalidatePath('/dashboard');
  return { success: true };
}

export async function getUserStreak(userId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('user_streaks')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error) return null;
  return data;
}
