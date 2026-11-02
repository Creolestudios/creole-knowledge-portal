import fs from 'node:fs';
import path from 'node:path';
import { supabaseAdmin } from '@/lib/supabase/admin';

export interface DigestRecipientRecord {
  id: string;
  email: string;
  is_active: boolean;
  created_at?: string;
  source?: 'database' | 'metadata_fallback';
}

function isSchemaCacheOrTableMissingError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as { code?: string; message?: string };
  const msg = (err.message || '').toLowerCase();
  const code = err.code || '';
  return (
    code === 'PGRST205' ||
    code === 'PGRST204' ||
    code === '42P01' ||
    msg.includes('schema cache') ||
    msg.includes('does not exist') ||
    msg.includes('relation')
  );
}

// Local filesystem fallback (resilient across server restarts during development)
const LOCAL_CACHE_DIR = path.join(process.cwd(), '.data');
const LOCAL_CACHE_FILE = path.join(LOCAL_CACHE_DIR, 'admin-digest-recipients.json');

function readLocalCache(): string[] {
  try {
    if (fs.existsSync(LOCAL_CACHE_FILE)) {
      const content = fs.readFileSync(LOCAL_CACHE_FILE, 'utf8');
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        return parsed
          .map((e) => (typeof e === 'string' ? e.trim().toLowerCase() : ''))
          .filter(Boolean);
      }
    }
  } catch {
    // Ignore read error
  }
  return [];
}

function writeLocalCache(emails: string[]): void {
  try {
    if (!fs.existsSync(LOCAL_CACHE_DIR)) {
      fs.mkdirSync(LOCAL_CACHE_DIR, { recursive: true });
    }
    fs.writeFileSync(
      LOCAL_CACHE_FILE,
      JSON.stringify(Array.from(new Set(emails)), null, 2),
      'utf8'
    );
  } catch {
    // Ignore write error in read-only environments
  }
}

async function getAdminUserMetadataFallback(): Promise<{ adminUserId: string | null; emails: string[] }> {
  try {
    if (typeof supabaseAdmin.auth?.admin?.listUsers !== 'function') {
      return { adminUserId: null, emails: readLocalCache() };
    }
    const listResult = await supabaseAdmin.auth.admin.listUsers();
    const listData = listResult?.data;
    if (!listData?.users || listData.users.length === 0) {
      return { adminUserId: null, emails: readLocalCache() };
    }

    let chosenUser = listData.users.find(
      (u) =>
        Array.isArray(u.user_metadata?.digest_recipient_emails) &&
        u.user_metadata.digest_recipient_emails.length > 0
    );

    if (!chosenUser) {
      chosenUser = listData.users[0];
    }

    const metaEmails = (chosenUser.user_metadata?.digest_recipient_emails as string[]) || [];
    const localEmails = readLocalCache();
    const combined = Array.from(new Set([...metaEmails, ...localEmails]))
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);

    return { adminUserId: chosenUser.id, emails: combined };
  } catch (err) {
    console.warn('[DigestRecipientsStore] Auth metadata fallback read warning:', err);
    return { adminUserId: null, emails: readLocalCache() };
  }
}

async function persistAdminUserMetadataFallback(emails: string[]): Promise<void> {
  const cleanEmails = Array.from(new Set(emails.map((e) => e.trim().toLowerCase()))).filter(Boolean);
  writeLocalCache(cleanEmails);

  try {
    if (
      typeof supabaseAdmin.auth?.admin?.listUsers !== 'function' ||
      typeof supabaseAdmin.auth?.admin?.updateUserById !== 'function'
    ) {
      return;
    }
    const listResult = await supabaseAdmin.auth.admin.listUsers();
    const listData = listResult?.data;
    if (!listData?.users || listData.users.length === 0) return;

    const targetUser = listData.users[0];
    const existing = (targetUser.user_metadata as Record<string, unknown>) || {};
    await supabaseAdmin.auth.admin.updateUserById(targetUser.id, {
      user_metadata: {
        ...existing,
        digest_recipient_emails: cleanEmails,
      },
    });
  } catch (err) {
    console.warn('[DigestRecipientsStore] Auth metadata fallback write warning:', err);
  }
}

/**
 * Retrieves the active digest recipient emails for daily report dispatches.
 * Seamlessly checks the database table first, falling back to schema-free Auth metadata
 * if the table has not yet been migrated.
 */
export async function getDigestRecipientEmails(): Promise<string[]> {
  try {
    let query: any = supabaseAdmin.from('admin_digest_recipients').select('email');
    if (typeof query?.eq === 'function') {
      query = query.eq('is_active', true);
    }
    const { data, error } = await query;

    if (!error && data) {
      return data.map((r: { email: string }) => r.email.trim().toLowerCase()).filter(Boolean);
    }

    if (error && isSchemaCacheOrTableMissingError(error)) {
      const { emails } = await getAdminUserMetadataFallback();
      return emails;
    }
  } catch (err) {
    console.warn('[DigestRecipientsStore] Query exception, falling back:', err);
  }

  const { emails } = await getAdminUserMetadataFallback();
  return emails;
}

/**
 * Retrieves all configured digest recipients for the admin management view.
 */
export async function getAllDigestRecipients(): Promise<DigestRecipientRecord[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from('admin_digest_recipients')
      .select('*')
      .order('created_at', { ascending: true });

    if (!error && data) {
      return data.map((r: { id?: string; email: string; is_active?: boolean; created_at?: string }) => ({
        id: r.id || r.email,
        email: r.email,
        is_active: r.is_active !== false,
        created_at: r.created_at,
        source: 'database',
      }));
    }

    if (error && isSchemaCacheOrTableMissingError(error)) {
      console.info(
        '[DigestRecipientsStore] Database table admin_digest_recipients not in schema cache; using resilient Auth metadata storage.'
      );
      const { emails } = await getAdminUserMetadataFallback();
      return emails.map((email) => ({
        id: email,
        email,
        is_active: true,
        source: 'metadata_fallback',
      }));
    }
  } catch (err) {
    console.warn('[DigestRecipientsStore] getAllDigestRecipients exception:', err);
  }

  const { emails } = await getAdminUserMetadataFallback();
  return emails.map((email) => ({
    id: email,
    email,
    is_active: true,
    source: 'metadata_fallback',
  }));
}

/**
 * Adds an email to the digest recipient list.
 * Writes to public.admin_digest_recipients if present, otherwise saves to resilient Auth metadata.
 */
export async function addDigestRecipientEmail(rawEmail: string): Promise<DigestRecipientRecord> {
  const email = rawEmail.trim().toLowerCase();
  const atIdx = email.indexOf('@');
  const dotIdx = email.lastIndexOf('.');
  const isValid = atIdx > 0 && dotIdx > atIdx + 1 && dotIdx < email.length - 1 && !email.includes(' ');
  if (!isValid) {
    throw new Error('Valid email address is required');
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('admin_digest_recipients')
      .upsert(
        {
          email,
          role: 'manager',
          is_active: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'email' }
      )
      .select()
      .single();

    if (!error && data) {
      // Also mirror to metadata fallback for resilience
      const { emails } = await getAdminUserMetadataFallback();
      if (!emails.includes(email)) {
        void persistAdminUserMetadataFallback([...emails, email]);
      }
      return {
        id: data.id || data.email,
        email: data.email,
        is_active: data.is_active !== false,
        created_at: data.created_at,
        source: 'database',
      };
    }

    if (error && !isSchemaCacheOrTableMissingError(error)) {
      console.warn('[DigestRecipientsStore] Upsert error other than schema cache:', error.message);
    }
  } catch (err) {
    console.warn('[DigestRecipientsStore] Upsert exception, falling back to metadata:', err);
  }

  // Fallback: save to metadata & local cache
  const { emails } = await getAdminUserMetadataFallback();
  const updated = Array.from(new Set([...emails, email]));
  await persistAdminUserMetadataFallback(updated);

  return {
    id: email,
    email,
    is_active: true,
    source: 'metadata_fallback',
  };
}

/**
 * Removes an email from the digest recipient list across database and fallback metadata.
 */
export async function removeDigestRecipientEmail(emailOrId: string): Promise<boolean> {
  const target = (emailOrId || '').trim().toLowerCase();
  if (!target) return false;

  try {
    if (target.includes('@')) {
      await supabaseAdmin.from('admin_digest_recipients').delete().eq('email', target);
    } else {
      await supabaseAdmin.from('admin_digest_recipients').delete().eq('id', target);
    }
  } catch {
    // Ignore database delete errors when table is missing
  }

  // Always remove from fallback metadata & local cache
  const { emails } = await getAdminUserMetadataFallback();
  const filtered = emails.filter((e) => e !== target);
  await persistAdminUserMetadataFallback(filtered);

  return true;
}
