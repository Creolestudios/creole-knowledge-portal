'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { DailyBlog } from '@/types/contracts';
import { getDailyBlog } from '@/lib/data/blogs';
import BlogArticle from './BlogArticle';
import BlogInfoPanel from './BlogInfoPanel';
import ReadingTimer from './ReadingTimer';
import QuizModal from './QuizModal';

/** Tab 1: today's personalized blog with a live reading timer and end-of-blog quiz. */
export default function DailyBlogTab() {
  const [blog, setBlog] = useState<DailyBlog | null>(null);
  const [quizOpen, setQuizOpen] = useState(false);

  useEffect(() => {
    void getDailyBlog().then(setBlog);
  }, []);

  if (!blog) {
    return (
      <div className="flex items-center justify-center py-24 text-zinc-400 gap-3">
        <Loader2 className="animate-spin" size={20} />
        <span className="font-semibold">Loading your morning blog…</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <ReadingTimer date={blog.date} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8 items-start">
        <div className="lg:col-span-2 order-2 lg:order-1">
          <BlogArticle blog={blog} onStartQuiz={() => setQuizOpen(true)} />
        </div>
        <div className="lg:col-span-1 order-1 lg:order-2">
          <BlogInfoPanel blog={blog} />
        </div>
      </div>

      <QuizModal
        quiz={blog.quiz}
        date={blog.date}
        open={quizOpen}
        onClose={() => setQuizOpen(false)}
      />
    </div>
  );
}
