import { NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/supabase/admin';
import {
  getZohoEvaluationRules,
  saveZohoEvaluationRules,
  DEFAULT_ZOHO_RULES,
  ZohoEvaluationRulesConfig,
} from '@/lib/zoho/rules-store';

export async function GET() {
  try {
    const adminCheck = await requireAdminUser();
    const isDev = process.env.NODE_ENV === 'development';
    if (!adminCheck && !isDev) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const rules = await getZohoEvaluationRules();
    return NextResponse.json({
      success: true,
      rules,
      defaults: DEFAULT_ZOHO_RULES,
    });
  } catch (error) {
    console.error('[Admin Rules API] GET error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch rules', rules: DEFAULT_ZOHO_RULES },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const adminCheck = await requireAdminUser();
    const isDev = process.env.NODE_ENV === 'development';
    if (!adminCheck && !isDev) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();

    if (body.reset === true) {
      const resetRules = await saveZohoEvaluationRules(DEFAULT_ZOHO_RULES);
      return NextResponse.json({
        success: true,
        message: 'Rules reset to recommended defaults',
        rules: resetRules,
      });
    }

    const targetRules = (body && typeof body === 'object' && 'rules' in body && body.rules) ? body.rules : body;
    const updated = await saveZohoEvaluationRules(targetRules);
    return NextResponse.json({
      success: true,
      message: 'Evaluation criteria updated successfully',
      rules: updated,
    });
  } catch (error) {
    console.error('[Admin Rules API] POST error:', error);
    return NextResponse.json(
      { error: 'Failed to update rules' },
      { status: 500 }
    );
  }
}
