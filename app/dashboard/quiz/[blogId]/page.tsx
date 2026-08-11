import { QuizRunner } from '@/components/quiz/quiz-runner';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export default async function QuizPage({ params }: { params: Promise<{ blogId: string }> }) {
  const resolvedParams = await params;
  
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white p-8 font-sans selection:bg-brand/30">
      <div className="max-w-4xl mx-auto">
        <Link 
          href="/dashboard" 
          className="inline-flex items-center gap-2 text-zinc-400 hover:text-white transition-colors text-sm font-semibold mb-8 group"
        >
          <ArrowLeft size={16} className="group-hover:-translate-x-1 transition-transform" />
          Back to Dashboard
        </Link>
        
        <QuizRunner blogId={resolvedParams.blogId} />
      </div>
    </div>
  );
}
