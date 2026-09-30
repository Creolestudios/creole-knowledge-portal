import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkRoles() {
  const { data, error } = await supabaseAdmin.from('user_profiles').select('email, role, current_role');
  console.log(data, error);
}
checkRoles();
