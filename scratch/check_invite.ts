import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import crypto from 'node:crypto';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

async function main() {
  const rawToken = '3126a6e85cb907d9d891474e76172e25d8b51434d4d0f996';
  const tokenHash = hashToken(rawToken);
  console.log('Checking invite rawToken:', rawToken);
  console.log('Hashed token:', tokenHash);

  const { data: invites } = await supabaseAdmin
    .from('interview_invites')
    .select('*')
    .eq('token_hash', tokenHash);

  console.log('Reset Invites:', invites);

  if (invites && invites.length > 0) {
    const { data: session } = await supabaseAdmin
      .from('interview_sessions')
      .update({ status: 'pending', updated_at: new Date().toISOString() })
      .eq('id', invites[0].session_id);
    console.log('Reset Session:', session);
  }

  const { data: aiInterviews } = await supabaseAdmin
    .from('ai_interviews')
    .select('*')
    .eq('id', tokenHash);

  console.log('AI Interviews:', aiInterviews);
}

main().catch(console.error);
