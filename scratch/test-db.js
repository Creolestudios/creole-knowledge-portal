import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
  const { data, error } = await supabaseAdmin
    .from('blogs')
    .insert({
      title: "test",
      url: "test-url-" + Date.now(),
      content: "test",
      source: "test",
      author: "test",
      summary: "test",
      tags: "tech, architecture", // passing string instead of array
      published_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .select('*')
    .single();
  
  console.log("Error:", JSON.stringify(error, null, 2));
}

run();
