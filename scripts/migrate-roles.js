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

async function migrate() {
  console.log('Running role migration...');

  // 1. Update mrmiitshah@yopmail.net to admin
  const { data: adminData, error: adminErr } = await supabase
    .from('user_profiles')
    .update({ role: 'admin' })
    .eq('email', 'mrmiitshah@yopmail.net');
  
  if (adminErr) {
    console.error('Error updating admin role:', adminErr);
  } else {
    console.log('Admin role updated.');
  }

  // 2. Migrate priyadhananis123@gmail.com
  const { data: priyaData, error: priyaErr } = await supabase
    .from('user_profiles')
    .update({ role: 'user', current_role: 'wordpress developer' })
    .eq('email', 'priyadhananis123@gmail.com');
  
  if (priyaErr) {
    console.error('Error updating priyadhananis123:', priyaErr);
  } else {
    console.log('priyadhananis123 role and current_role updated.');
  }

  // 3. Update all other users to 'user' role where role is null
  const { data: others, error: fetchErr } = await supabase
    .from('user_profiles')
    .select('id, email, role');
  
  if (fetchErr) {
    console.error('Error fetching users:', fetchErr);
    return;
  }

  for (const p of others) {
    if (p.email !== 'mrmiitshah@yopmail.net' && p.email !== 'priyadhananis123@gmail.com' && !p.role) {
      const { error: updateErr } = await supabase
        .from('user_profiles')
        .update({ role: 'user' })
        .eq('id', p.id);
      
      if (updateErr) {
        console.error(`Error updating role for ${p.email}:`, updateErr);
      } else {
        console.log(`Set ${p.email} role to 'user'.`);
      }
    }
  }

  console.log('Migration completed!');
}

migrate();
