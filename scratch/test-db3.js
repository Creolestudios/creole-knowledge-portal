import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
  const { data: quizAttempts, error } = await supabase
      .from('quiz_attempts')
      .select('*, quiz_answers(is_correct, created_at)')
      .limit(1);
    
  console.log("Quiz attempts error:", error);
  console.log("Quiz attempts data:", quizAttempts);
}
run();
