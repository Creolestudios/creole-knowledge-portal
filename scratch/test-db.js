import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
  const { data: users } = await supabase.auth.admin.listUsers();
  if (users.users.length === 0) {
    console.log("No users found");
    return;
  }
  const user = users.users[0];
  console.log("User:", user.email);
  
  const { data: logs, error } = await supabase
    .from('user_activity_logs')
    .select('*')
    .eq('user_id', user.id);
    
  console.log("Logs error:", error);
  console.log("Logs:", logs);
  
  const { data: quizAttempts } = await supabase
    .from('quiz_attempts')
    .select('*')
    .eq('user_id', user.id);
    
  console.log("Quiz attempts:", quizAttempts);
}
run();
