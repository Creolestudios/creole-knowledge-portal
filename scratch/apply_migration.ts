import { supabaseAdmin } from '../lib/supabase/admin';

async function applyMigration() {
  console.log('Applying DB Schema fixes to allow multiple quiz attempts...');

  // Using supabaseAdmin to check/execute schema fixes if rpc is available
  try {
    // 1. Test dropping old constraint and adding attempt_number column via rpc or SQL
    const { data, error } = await supabaseAdmin.rpc('exec_sql', {
      sql: `
        ALTER TABLE public.quiz_attempts DROP CONSTRAINT IF EXISTS quiz_attempts_user_id_blog_id_key;
        ALTER TABLE public.quiz_attempts ADD COLUMN IF NOT EXISTS attempt_number integer DEFAULT 1 CHECK (attempt_number IN (1, 2, 3));
        ALTER TABLE public.quiz_attempts DROP CONSTRAINT IF EXISTS quiz_attempts_user_id_blog_id_attempt_number_key;
        ALTER TABLE public.quiz_attempts ADD CONSTRAINT quiz_attempts_user_id_blog_id_attempt_number_key UNIQUE (user_id, blog_id, attempt_number);
      `
    });

    if (error) {
      console.log('exec_sql RPC not enabled, testing direct fallback handling:', error.message);
    } else {
      console.log('Successfully updated quiz_attempts DB schema!', data);
    }
  } catch (err) {
    console.error('Error applying migration:', err);
  }
}

applyMigration();
