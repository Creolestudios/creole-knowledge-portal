const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

// Simple parse for .env.local
try {
  const content = fs.readFileSync('.env', 'utf8');
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
      process.env[key] = val;
    }
  });
} catch (e) {
  console.error('Failed to load .env', e);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing URL or Key in process.env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function inspect() {
  console.log('Inspecting Supabase Database...');
  
  // Test user_profiles
  const { data: profiles, error: pError } = await supabase.from('user_profiles').select('*').limit(5);
  if (pError) {
    console.error('Error user_profiles:', pError.message);
  } else {
    console.log('user_profiles count:', profiles.length, profiles);
  }

  // Test blog_sources
  const { data: sources, error: sError } = await supabase.from('blog_sources').select('*').limit(5);
  if (sError) {
    console.error('Error blog_sources:', sError.message);
  } else {
    console.log('blog_sources count:', sources.length, sources);
  }

  // Test daily_digests
  const { data: digests, error: dError } = await supabase.from('daily_digests').select('*').limit(5);
  if (dError) {
    console.error('Error daily_digests:', dError.message);
  } else {
    console.log('daily_digests count:', digests?.length, digests);
  }

  // Test articles
  const { data: articles, error: aError } = await supabase.from('articles').select('*').limit(5);
  if (aError) {
    console.error('Error articles:', aError.message);
  } else {
    console.log('articles count:', articles?.length, articles);
  }
}

inspect();
