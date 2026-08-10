import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Try to fetch activity, if table doesn't exist, this will error
    // In a real app, ensure `user_activity` table is created
    const { data: records, error } = await supabase
      .from('user_activity')
      .select('*')
      .eq('user_id', user.id)
      .order('date', { ascending: false });

    if (error) {
      if (error.code === '42P01') {
        // Table doesn't exist, return empty for now
        return NextResponse.json({ success: true, records: [], streak: 0 });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Calculate basic streak (mock logic based on consecutive days)
    let streak = 0;
    const today = new Date();
    today.setHours(0,0,0,0);
    
    // Sort records descending by date
    const sorted = [...(records || [])].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    
    let currentDate = new Date(today);
    
    for (const r of sorted) {
      const rDate = new Date(r.date);
      rDate.setHours(0,0,0,0);
      
      // If it's today or yesterday and read_seconds > 0, we can start counting
      if (rDate.getTime() === currentDate.getTime() || rDate.getTime() === currentDate.getTime() - 86400000) {
        if (r.read_seconds > 0) {
          streak++;
          currentDate = rDate;
          currentDate.setDate(currentDate.getDate() - 1);
        } else {
          break;
        }
      } else {
        break;
      }
    }

    return NextResponse.json({
      success: true,
      records: records || [],
      streak
    });
  } catch (error: any) {
    console.error('Error in activity route:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { date, readSeconds, quizScore, quizTotal } = body;

    if (!date) {
      return NextResponse.json({ error: 'Date is required' }, { status: 400 });
    }

    // Check if record exists
    const { data: existing } = await supabase
      .from('user_activity')
      .select('*')
      .eq('user_id', user.id)
      .eq('date', date)
      .single();

    let updateData: any = {};
    if (readSeconds !== undefined) {
      updateData.read_seconds = (existing?.read_seconds || 0) + readSeconds;
    }
    if (quizScore !== undefined) {
      updateData.quiz_score = quizScore;
      updateData.quiz_total = quizTotal;
      updateData.quiz_taken = true;
    }

    let result;
    if (existing) {
      result = await supabase
        .from('user_activity')
        .update(updateData)
        .eq('id', existing.id);
    } else {
      updateData.user_id = user.id;
      updateData.date = date;
      result = await supabase
        .from('user_activity')
        .insert(updateData);
    }

    if (result.error) {
      // Ignore if table doesn't exist for now
      if (result.error.code === '42P01') {
        console.warn('user_activity table does not exist');
        return NextResponse.json({ success: true, message: 'Simulated activity update (table missing)' });
      }
      return NextResponse.json({ error: result.error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error in activity POST:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
