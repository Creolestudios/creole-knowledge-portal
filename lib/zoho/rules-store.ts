import fs from 'node:fs';
import path from 'node:path';
import { ZohoEvaluationRulesConfig, DEFAULT_ZOHO_RULES } from './rules-types';

export * from './rules-types';

// Local filesystem fallback (resilient across server restarts during development)
const LOCAL_CACHE_DIR = path.join(process.cwd(), '.data');
const LOCAL_CACHE_FILE = path.join(LOCAL_CACHE_DIR, 'zoho-evaluation-rules.json');

function readLocalCache(): ZohoEvaluationRulesConfig | null {
  try {
    if (fs.existsSync(LOCAL_CACHE_FILE)) {
      const content = fs.readFileSync(LOCAL_CACHE_FILE, 'utf8');
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === 'object') {
        return {
          ...DEFAULT_ZOHO_RULES,
          ...parsed,
        };
      }
    }
  } catch {
    // Ignore read error
  }
  return null;
}

function writeLocalCache(rules: ZohoEvaluationRulesConfig): void {
  try {
    if (!fs.existsSync(LOCAL_CACHE_DIR)) {
      fs.mkdirSync(LOCAL_CACHE_DIR, { recursive: true });
    }
    fs.writeFileSync(LOCAL_CACHE_FILE, JSON.stringify(rules, null, 2), 'utf8');
  } catch {
    // Ignore write error
  }
}

async function getAdminClient() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  try {
    const { supabaseAdmin } = await import('@/lib/supabase/admin');
    return supabaseAdmin;
  } catch {
    return null;
  }
}

/**
 * Retrieves the active Global Zoho Evaluation Rules.
 * Falls back seamlessly to DEFAULT_ZOHO_RULES.
 */
export async function getZohoEvaluationRules(): Promise<ZohoEvaluationRulesConfig> {
  try {
    const admin = await getAdminClient();
    if (admin) {
      const { data, error } = await admin
        .from('zoho_evaluation_rules')
        .select('rules_config')
        .eq('id', 'global')
        .single();

      if (!error && data?.rules_config) {
        const dbConfig = data.rules_config as Partial<ZohoEvaluationRulesConfig>;
        const merged = { ...DEFAULT_ZOHO_RULES, ...dbConfig };
        writeLocalCache(merged);
        return merged;
      }
    }
  } catch {
    // Fall through to local cache or defaults
  }

  const cached = readLocalCache();
  if (cached) return cached;

  return { ...DEFAULT_ZOHO_RULES };
}

function normalizeRules(rules: Partial<ZohoEvaluationRulesConfig>): Partial<ZohoEvaluationRulesConfig> {
  const normalized = { ...rules };
  if (normalized.workMatchWeight !== undefined && normalized.workMatchWeight > 1) {
    normalized.workMatchWeight = Number((normalized.workMatchWeight / 100).toFixed(2));
  }
  if (normalized.timeAdherenceWeight !== undefined && normalized.timeAdherenceWeight > 1) {
    normalized.timeAdherenceWeight = Number((normalized.timeAdherenceWeight / 100).toFixed(2));
  }
  if (normalized.complexityWeight !== undefined && normalized.complexityWeight > 1) {
    normalized.complexityWeight = Number((normalized.complexityWeight / 100).toFixed(2));
  }
  if (normalized.repetitionWeight !== undefined && normalized.repetitionWeight > 1) {
    normalized.repetitionWeight = Number((normalized.repetitionWeight / 100).toFixed(2));
  }
  return normalized;
}

/**
 * Saves updated Global Zoho Evaluation Rules.
 */
export async function saveZohoEvaluationRules(
  updatedRules: Partial<ZohoEvaluationRulesConfig>
): Promise<ZohoEvaluationRulesConfig> {
  const current = await getZohoEvaluationRules();
  const normalized = normalizeRules(updatedRules);
  const merged: ZohoEvaluationRulesConfig = {
    ...current,
    ...normalized,
  };

  // Always write to local cache
  writeLocalCache(merged);

  try {
    const admin = await getAdminClient();
    if (admin) {
      await admin.from('zoho_evaluation_rules').upsert(
        {
          id: 'global',
          rules_config: merged,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' }
      );
    }
  } catch (err) {
    console.warn('[RulesStore] Could not persist zoho_evaluation_rules to database, saved locally:', err);
  }

  return merged;
}
