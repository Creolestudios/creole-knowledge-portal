'use client';

import { useEffect, useRef, useState } from 'react';
import { Search, FileText, X } from 'lucide-react';
import { getBlogIndex, searchBlogIndex, type BlogIndexEntry } from '@/lib/data/blogs';

/**
 * Header search. Filters all blogs by title/tag and, on selection, jumps the
 * dashboard to the Past Blogs tab for that date via `onPick`.
 */
export default function GlobalSearch({ onPick }: { onPick: (date: string) => void }) {
  const [index, setIndex] = useState<BlogIndexEntry[]>([]);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void getBlogIndex().then(setIndex);
  }, []);

  // Close the dropdown on outside click.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const results = searchBlogIndex(index, query);

  const pick = (date: string) => {
    onPick(date);
    setQuery('');
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative w-full max-w-md">
      <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400" size={16} />
      <input
        type="text"
        id="portal-search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search blogs by title or topic..."
        className="w-full pl-12 pr-9 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand text-sm transition-all"
      />
      {query && (
        <button
          type="button"
          id="search-clear"
          onClick={() => setQuery('')}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700 cursor-pointer"
          aria-label="Clear search"
        >
          <X size={15} />
        </button>
      )}

      {open && query.trim() !== '' && (
        <div className="absolute z-30 mt-2 w-full bg-white border border-zinc-200 rounded-2xl shadow-xl overflow-hidden max-h-80 overflow-y-auto">
          {results.length === 0 ? (
            <p className="px-5 py-4 text-sm text-zinc-400 font-medium">No blogs match “{query}”.</p>
          ) : (
            results.map((r) => (
              <button
                type="button"
                key={r.date}
                id={`search-result-${r.date}`}
                onClick={() => pick(r.date)}
                className="w-full text-left px-5 py-3 hover:bg-zinc-50 transition-colors flex items-start gap-3 border-b border-zinc-50 last:border-0 cursor-pointer"
              >
                <FileText size={15} className="text-brand shrink-0 mt-0.5" />
                <span>
                  <span className="block text-sm font-bold text-zinc-900 leading-tight">
                    {r.title}
                  </span>
                  <span className="block text-[11px] text-zinc-400 font-medium mt-0.5">
                    {new Date(r.date).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}{' '}
                    · {r.tags.slice(0, 3).join(', ')}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
