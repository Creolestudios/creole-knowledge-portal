const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const content = fs.readFileSync('.env', 'utf8');
const env = {};
content.split('\n').forEach(line => {
  line = line.trim();
  if (!line || line.startsWith('#')) return;
  const parts = line.split('=');
  if (parts.length >= 2) {
    const key = parts[0].trim();
    let val = parts.slice(1).join('=').trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.substring(1, val.length - 1);
    }
    env[key] = val;
  }
});

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
  const { data: { users }, error: authError } = await supabase.auth.admin.listUsers();
  if (authError) {
    console.error('Auth error:', authError);
    return;
  }
  console.log('--- AUTH USERS ---');
  users.forEach(u => console.log(`ID: ${u.id}, Email: ${u.email}`));

  const { data: profiles, error: profileError } = await supabase.from('user_profiles').select('*');
  if (profileError) {
    console.error('Profile error:', profileError);
    return;
  }
  console.log('--- USER PROFILES ---');
  profiles.forEach(p => console.log(`UserID: ${p.user_id}, Email: ${p.email}, Role: ${p.role}`));
}

check();
