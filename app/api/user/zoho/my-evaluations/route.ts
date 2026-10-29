import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { resolveDateFilterRange, getMockZohoData, ZohoUserSummary } from '@/lib/zoho/service';

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    const { searchParams } = new URL(request.url);
    const filterType = (searchParams.get('type') || 'week') as 'week' | 'month' | 'range';
    const weekOffset = parseInt(searchParams.get('weekOffset') || '0', 10);
    const monthOffset = parseInt(searchParams.get('monthOffset') || '0', 10);
    const startDate = searchParams.get('startDate') || undefined;
    const endDate = searchParams.get('endDate') || undefined;

    const dateRange = resolveDateFilterRange({
      type: filterType,
      weekOffset,
      monthOffset,
      startDate,
      endDate,
    });

    // Provide the logged-in user's evaluation or first mock user if unauthenticated in dev
    const allUsers = getMockZohoData();
    let myData: ZohoUserSummary | undefined;

    if (user?.email) {
      myData = allUsers.find(u => u.email.toLowerCase() === user.email?.toLowerCase());
    }

    if (!myData) {
      // Default to the first profile for local evaluation testing
      myData = {
        ...allUsers[0],
        email: user?.email || allUsers[0].email,
        name: user?.user_metadata?.full_name || allUsers[0].name,
      };
    }

    return NextResponse.json({
      readOnly: true,
      filter: {
        type: filterType,
        range: dateRange,
      },
      evaluation: myData,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
