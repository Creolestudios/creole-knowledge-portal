# Skill: Create a New React Component

## When to Use
Use this when adding a new shared UI component to `components/` or a page-specific component.

## Step-by-Step

### 1. Decide: Server or Client?
- **Server Component** (default): data fetching, no hooks, no browser APIs → no directive needed
- **Client Component**: needs `useState`, `useEffect`, event handlers, browser APIs → add `'use client'` at top

### 2. Create the file
```
components/MyComponent.tsx   # shared
app/dashboard/MyWidget.tsx   # page-specific (if only used there)
```

### 3. Component template (Client)
```typescript
'use client';

import { useState } from 'react';
import { SomeIcon } from 'lucide-react';
import { motion } from 'motion/react';

interface MyComponentProps {
  title: string;
  onAction?: () => void;
}

export default function MyComponent({ title, onAction }: MyComponentProps) {
  const [active, setActive] = useState(false);

  return (
    <motion.div
      id="my-component"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-2xl shadow-card border border-zinc-100 p-6"
    >
      <h2 className="text-xl font-bold text-zinc-900">{title}</h2>
      <button
        id="my-component-action-btn"
        onClick={onAction}
        className="mt-4 bg-brand hover:bg-brand-hover text-black font-bold py-2 px-4 rounded-lg transition-all"
      >
        Action
      </button>
    </motion.div>
  );
}
```

### 4. Component template (Server)
```typescript
import { createClient } from '@/lib/supabase/server';
import { SomeIcon } from 'lucide-react';

interface MyServerComponentProps {
  userId: string;
}

export default async function MyServerComponent({ userId }: MyServerComponentProps) {
  const supabase = await createClient();
  const { data, error } = await supabase.from('table').select('*').eq('user_id', userId);

  if (error) return <div>Error loading data</div>;

  return (
    <section id="my-section" className="p-6">
      {data.map((item) => (
        <div key={item.id}>{item.name}</div>
      ))}
    </section>
  );
}
```

### 5. Checklist before finishing
- [ ] Unique `id` on root element and key interactive elements
- [ ] Error state handled (not just happy path)
- [ ] Loading state if async (use `Loader2` from lucide-react)
- [ ] Responsive: mobile-first Tailwind classes
- [ ] Animation: wrap with `motion.div` for entrance animation
- [ ] No inline styles for static values (use Tailwind)
- [ ] Types: no `any` without comment

### 6. Run lint check
```bash
npm run lint
```
