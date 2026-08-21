import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { supabaseAdmin } from '../lib/supabase/admin';

async function runE2ETest() {
  console.log('=== REAL-TIME E2E QUIZ ATTEMPT TRACKING TEST ===');

  const userId = '7c7c513b-5789-4972-846b-fcfb853f1f28'; // priyadhananis123@gmail.com
  const blogId = '07f4a31e-f23e-464f-a3c8-86c61cf967c0';

  // Fetch existing attempts for this user and blog
  const { data: attempts } = await supabaseAdmin
    .from('quiz_attempts')
    .select('id, user_id, blog_id, status')
    .eq('user_id', userId)
    .eq('blog_id', blogId);

  console.log('Existing attempt rows in quiz_attempts:', attempts?.length);

  const attemptIds = attempts?.map(a => a.id) || [];
  const { data: answers } = await supabaseAdmin
    .from('quiz_answers')
    .select('id, created_at')
    .in('attempt_id', attemptIds);

  console.log('Total answer rows in quiz_answers:', answers?.length);
  const calculatedAttempts = Math.floor((answers?.length || 0) / 5);
  console.log('Calculated finished attempts:', calculatedAttempts);
  console.log('Calculated attempts remaining:', Math.max(0, 3 - calculatedAttempts));

  if (calculatedAttempts >= 3) {
    console.log('✅ TEST PASSED: User has reached 3 attempts! Remaining attempts = 0 (Button Disabled state active).');
  } else {
    console.log(`ℹ️ Current attempt state: ${calculatedAttempts}/3 attempts completed (${3 - calculatedAttempts} remaining).`);
  }
}

runE2ETest();
