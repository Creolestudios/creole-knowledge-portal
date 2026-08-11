const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const content = fs.readFileSync('.env.local', 'utf8');
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

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(url, key);

const mockUser = 'b632b1ab-71e5-48ca-ab5d-b431c4e65004';
const todayStr = new Date().toISOString().split('T')[0];
const briefUrl = `briefing:${mockUser}:${todayStr}`;

const mockBriefing = {
  title: `Morning Briefing — Technical Architecture & Scaling Policies`,
  url: briefUrl,
  source: "AI Factory Seed",
  author: "Creole AI Factory",
  summary: "A customized morning technical brief synthesizing Next.js 15 Server Actions, Advanced TypeScript conditional typings, and Supabase RLS scaling models.",
  tags: ["nextjs", "typescript", "supabase", "performance"],
  content: `
# Technical Architecture & Scaling Policies

Welcome to your daily morning brief. Today, we are deep diving into three high-priority engineering paradigms that directly impact performance, type-safety, and database scalability inside Creole internal tools.

## 1. Securing Next.js 15 Server Actions

With **Next.js 15** and **React 19**, Server Actions have become the default standard for data mutation. However, they are compiled into public HTTP POST endpoints under the hood. You must validate user authorization directly inside the actions.

\`\`\`typescript
'use server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export async function submitQuizAnswers(formData: FormData) {
  // Always verify authentication inside the action
  const session = await getSession();
  if (!session) throw new Error('Unauthorized');
  
  // Safe input validation
  const quizId = formData.get('quizId') as string;
  if (!quizId) throw new Error('Invalid input');
  
  // Run mutation
  return { success: true };
}
\`\`\`

## 2. Programmatic Types with TypeScript 5.x

Leveraging TypeScript generics and conditional types reduces redundant code blocks while providing absolute compile-time safety:

\`\`\`typescript
type DBResult<T> = T extends 'user' 
  ? { id: string; name: string }
  : T extends 'blog' 
  ? { id: string; title: string }
  : never;
\`\`\`

Using this programmatic matching, return types are dynamically resolved during function execution, eliminating unsafe type-assertion casting.

## 3. Optimizing Row Level Security (RLS) in Supabase

RLS provides fine-grained control, but executing slow nested joins inside policies degrades query execution times. Standardize on pre-caching user role claims directly within JWT auth session parameters:

\`\`\`sql
-- High-Performance RLS Policy
CREATE POLICY "Fast user access" ON blogs
  FOR SELECT USING (
    (auth.jwt() ->> 'email') LIKE '%@creolestudios.com'
  );
\`\`\`

---

## Daily Takeaways
- **Authorization**: Secure every server action with direct session queries.
- **Type Safety**: Avoid using general 'any' casts; use conditional typings.
- **DB Performance**: Tune RLS policies to bypass nested select statements.

---

<!-- QUIZ_DATA: {
  "questions": [
    {
      "id": "q1",
      "text": "Are Next.js Server Actions automatically secure from anonymous external HTTP requests?",
      "options": [
        "A) Yes, Next.js handles server encryption and hides the routes completely.",
        "B) No, they are compiled as public POST endpoints and must verify authorization inside.",
        "C) Yes, they are only executable by verified client React bundles.",
        "D) Yes, if they are marked with the 'use action' directive."
      ],
      "correctAnswer": "B",
      "explanation": "Server Actions compile to public endpoints. Developer verification of sessions is required inside the action to prevent unauthenticated executions."
    },
    {
      "id": "q2",
      "text": "What is the primary benefit of Conditional Types in TypeScript?",
      "options": [
        "A) They run faster at runtime inside the browser.",
        "B) They allow types to be determined dynamically at runtime by javascript.",
        "C) They calculate types dynamically at compile-time based on input generic conditions.",
        "D) They replace standard if-else statements inside functional components."
      ],
      "correctAnswer": "C",
      "explanation": "Conditional types allow programmatic type computation at compile-time based on type matching, giving robust generic versatility."
    },
    {
      "id": "q3",
      "text": "How can you optimize Row Level Security (RLS) performance in Supabase database tables?",
      "options": [
        "A) Disable indexing on the table.",
        "B) Avoid nested database select joins inside policies by using JWT session claims.",
        "C) Perform queries only through administrative service keys.",
        "D) Encrypt the whole table at rest."
      ],
      "correctAnswer": "B",
      "explanation": "Avoiding database subquery lookups inside RLS evaluations significantly improves query response speeds. JWT session claims should be checked instead."
    }
  ]
} -->
`
};

async function seed() {
  console.log(`Seeding mock daily morning brief for user: ${mockUser} under date: ${todayStr}...`);

  // Delete any briefing for this user for today to allow overwrite/regenerate
  await supabase
    .from('blogs')
    .delete()
    .eq('url', briefUrl);

  const { data: newBlog, error: insertError } = await supabase
    .from('blogs')
    .insert({
      title: mockBriefing.title,
      url: mockBriefing.url,
      source: mockBriefing.source,
      author: mockBriefing.author,
      summary: mockBriefing.summary,
      tags: mockBriefing.tags,
      content: mockBriefing.content,
      published_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .select('*')
    .single();

  if (insertError) {
    console.error('Error inserting daily brief:', insertError.message);
    return;
  }

  console.log(`Successfully seeded daily briefing ID: ${newBlog.id}`);

  // Link in daily_30_curation
  await supabase
    .from('daily_30_curation')
    .delete()
    .eq('curated_date', todayStr)
    .eq('display_order', 0);

  const { error: curError } = await supabase
    .from('daily_30_curation')
    .insert({
      blog_id: newBlog.id,
      curated_date: todayStr,
      display_order: 0,
      curation_notes: `Personalized brief seed for user ${mockUser}`
    });

  if (curError) {
    console.error('Error linking daily curation:', curError.message);
  } else {
    console.log('Successfully linked in daily curation!');
  }
}

seed();
