import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requireUser } from '@/lib/api/require-user';
import { generateQuizForBlog } from '@/lib/ai/quiz-generator';
import { blogServiceHeaders, blogServiceUrl } from '@/lib/blog-service';
import { toValidUUID } from '@/lib/quizzes/review';

export async function POST(request: Request) {
  try {
    const { user, errorResponse } = await requireUser();
    if (errorResponse) return errorResponse;

    const { blogId } = await request.json();

    if (!blogId) {
      return NextResponse.json({ error: 'Blog ID is required' }, { status: 400 });
    }

    const formattedBlogId = toValidUUID(String(blogId));

    // Enforce retry restriction (maxAttempts = 3) and check if passed
    let completedAttempts: any = null;
    let attemptsError: any = null;

    const firstQueryResult = await supabaseAdmin
      .from('quiz_attempts')
      .select('id, score, status, passed, started_at, total_questions')
      .eq('user_id', user.id)
      .eq('blog_id', formattedBlogId);

    completedAttempts = firstQueryResult.data;
    attemptsError = firstQueryResult.error;
    let columnsSupported = { passed: true, attempt_number: true };

    if (attemptsError) {
      if (attemptsError.code === '42703' || attemptsError.message.includes('passed')) {
        columnsSupported.passed = false;
        const fallbackQuery = await supabaseAdmin
          .from('quiz_attempts')
          .select('id, score, status, started_at, total_questions')
          .eq('user_id', user.id)
          .eq('blog_id', formattedBlogId);
        
        completedAttempts = fallbackQuery.data;
        attemptsError = fallbackQuery.error;
      }
    }

    if (attemptsError) {
      console.warn('Warning fetching quiz attempts (using empty fallback):', attemptsError);
      completedAttempts = [];
    }

    const hasPassed = completedAttempts?.some((a: any) => {
      if (columnsSupported.passed && a.passed) return true;
      return a.score !== null && a.score >= 3;
    }) || false;

    if (hasPassed) {
      return NextResponse.json({ error: 'You have already passed the quiz for this blog.' }, { status: 403 });
    }

    let finishedAttemptsCount = 0;
    if (completedAttempts && completedAttempts.length > 0) {
      if (completedAttempts.length > 1) {
        finishedAttemptsCount = completedAttempts.filter((a: any) => a.status === 'completed').length;
      } else {
        const single = completedAttempts[0];
        const tq = single.total_questions || 5;
        const attemptNum = tq >= 25 ? 3 : (tq >= 15 ? 2 : 1);
        if (single.status === 'completed') {
          finishedAttemptsCount = attemptNum;
        } else {
          finishedAttemptsCount = Math.max(0, attemptNum - 1);
        }
      }
    }

    if (finishedAttemptsCount >= 3) {
      return NextResponse.json({ error: 'You have exhausted all 3 attempts for this quiz.' }, { status: 403 });
    }

    // Handle resume for an active attempt
    const activeAttempt = completedAttempts?.find((a: any) => a.status === 'in_progress');
    if (activeAttempt) {
      // Find what questions are in this attempt from quiz_answers
      const { data: activeAnswers, error: activeAnsErr } = await supabaseAdmin
        .from('quiz_answers')
        .select('question_id')
        .eq('attempt_id', activeAttempt.id);

      if (!activeAnsErr && activeAnswers && activeAnswers.length > 0) {
        const questionIds = activeAnswers.map(a => a.question_id);
        const { data: questions, error: questionsError } = await supabaseAdmin
          .from('quiz_questions')
          .select('id, question_type, difficulty, question, options, code_snippet')
          .in('id', questionIds);

        if (!questionsError && questions && questions.length > 0) {
          return NextResponse.json({
            attemptId: activeAttempt.id,
            questions,
            startedAt: activeAttempt.started_at,
          });
        }
      }
    }

    // Fetch all question IDs answered in previous attempts for this blog by this user
    const attemptIds = completedAttempts?.map((a: any) => a.id) || [];
    let answeredQuestionIds: string[] = [];
    if (attemptIds.length > 0) {
      const { data: answeredRows } = await supabaseAdmin
        .from('quiz_answers')
        .select('question_id')
        .in('attempt_id', attemptIds);
      answeredQuestionIds = answeredRows?.map(r => r.question_id) || [];
    }

    // Fetch all existing questions in pool for this blog
    let { data: allQuestions } = await supabaseAdmin
      .from('quiz_questions')
      .select('id, question_type, difficulty, question, options, code_snippet')
      .eq('blog_id', formattedBlogId);

    const answeredSet = new Set(answeredQuestionIds);
    let availableQuestions = (allQuestions || []).filter(q => !answeredSet.has(q.id));

    let fallbackWarning: string | null = null;

    // If fewer than 5 unattempted questions are available in DB, generate a new batch of 5 questions on demand
    if (availableQuestions.length < 5) {
      let blogContent: string | null = null;
      const { data: blog } = await supabaseAdmin
        .from('blogs')
        .select('content')
        .eq('id', blogId)
        .single();

      if (blog && blog.content) {
        blogContent = blog.content;
      } else {
        try {
          const res = await fetch(blogServiceUrl(`/digests/${user.id}/latest`), {
            headers: blogServiceHeaders(),
          });
          if (res.ok) {
            const payload = await res.json();
            if (payload?.blog?.content) {
              blogContent = payload.blog.content;
            }
          }
        } catch (e) {
          console.warn('[Quiz Start] Could not fetch blog from microservice:', e);
        }
      }

      if (blogContent) {
        const existingTexts = (allQuestions || []).map(q => q.question);
        try {
          console.log(`[Quiz On-Demand] Generating 5 fresh unattempted questions for blog ${blogId}...`);
          const genResult = await generateQuizForBlog(formattedBlogId, blogContent, 5, existingTexts);

          if (genResult && genResult.usedFallback) {
            fallbackWarning = 'Due to AI rate limits, we have loaded a default deterministic quiz covering core architectural concepts.';
          }

          const { data: reloadedQuestions } = await supabaseAdmin
            .from('quiz_questions')
            .select('id, question_type, difficulty, question, options, code_snippet')
            .eq('blog_id', formattedBlogId);

          allQuestions = reloadedQuestions || [];
          availableQuestions = allQuestions.filter(q => !answeredSet.has(q.id));
        } catch (genErr: any) {
          console.error('[Quiz On-Demand] Error generating question batch:', genErr);
          if (availableQuestions.length === 0) {
            if (!allQuestions || allQuestions.length === 0) {
              return NextResponse.json({ error: `Quiz generation error: ${genErr.message}` }, { status: 500 });
            }
            availableQuestions = allQuestions;
            fallbackWarning = 'AI generation is currently busy or rate-limited. Falling back to previously generated questions for this attempt.';
          }
        }
      } else if (availableQuestions.length === 0) {
        if (!allQuestions || allQuestions.length === 0) {
          return NextResponse.json({ error: 'No quiz found for this blog.' }, { status: 404 });
        }
        availableQuestions = allQuestions;
      }
    }

    let selectedQuestions = availableQuestions;
    if (selectedQuestions.length < 5 && allQuestions && allQuestions.length > 0) {
      // Fallback if AI generated fewer than 5: fill remaining from unselected questions
      const remainingCount = 5 - selectedQuestions.length;
      const fallbackQuestions = allQuestions.filter(q => !selectedQuestions.some(sq => sq.id === q.id));
      selectedQuestions = [...selectedQuestions, ...fallbackQuestions.slice(0, remainingCount)];
      if (!fallbackWarning) {
        fallbackWarning = 'AI could not generate enough unique questions. Falling back to previous questions to complete this attempt.';
      }
    } else {
      selectedQuestions = selectedQuestions.slice(0, 5);
    }

    // Randomize order of questions for a varied experience (Fisher-Yates shuffle)
    const randomizedQuestions = [...selectedQuestions];
    for (let i = randomizedQuestions.length - 1; i > 0; i--) {
      const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
      [randomizedQuestions[i], randomizedQuestions[j]] = [randomizedQuestions[j], randomizedQuestions[i]];
    }

    // Create a new attempt record
    const attemptNumber = finishedAttemptsCount + 1;
    const insertPayload: any = {
      user_id: user.id,
      blog_id: formattedBlogId,
      status: 'in_progress',
      total_questions: randomizedQuestions.length
    };

    if (columnsSupported.attempt_number) {
      insertPayload.attempt_number = attemptNumber;
    }

    let { data: attempt, error: attemptError } = await supabaseAdmin
      .from('quiz_attempts')
      .insert(insertPayload)
      .select('*')
      .single();

    if (attemptError && (attemptError.code === '42703' || attemptError.message.includes('attempt_number'))) {
      columnsSupported.attempt_number = false;
      delete insertPayload.attempt_number;

      const retryResult = await supabaseAdmin
        .from('quiz_attempts')
        .insert(insertPayload)
        .select('*')
        .single();
      
      attempt = retryResult.data;
      attemptError = retryResult.error;
    }

    if (attemptError && attemptError.code === '23505') {
      // Unique constraint violation (maxAttempts = 1 unique constraint is active in DB)
      // Fallback to updating/resetting the existing completed attempt row
      const nextAttemptNum = finishedAttemptsCount + 1;
      const targetTotalQuestions = nextAttemptNum >= 3 ? 25 : (nextAttemptNum === 2 ? 15 : 5);

      const updatePayload: any = {
        status: 'in_progress',
        score: null,
        percentage: null,
        completed_at: null,
        total_questions: targetTotalQuestions,
        time_taken_seconds: null,
        started_at: new Date().toISOString()
      };

      if (columnsSupported.passed) {
        updatePayload.passed = null;
      }

      const { data: updatedAttempt, error: updateErr } = await supabaseAdmin
        .from('quiz_attempts')
        .update(updatePayload)
        .eq('user_id', user.id)
        .eq('blog_id', formattedBlogId)
        .select('*')
        .single();
      
      attempt = updatedAttempt;
      attemptError = updateErr;

      if (attempt?.id) {
        // We no longer delete previous answers here!
        // This ensures all 3 attempts (up to 15 answers) are stored in the database.
      }
    }

    if (attemptError) {
      console.error('Failed to start quiz attempt:', attemptError);
      return NextResponse.json({ error: 'Failed to start quiz.' }, { status: 500 });
    }

    // Pre-populate placeholder answers for this attempt
    if (attempt && randomizedQuestions.length > 0) {
      const placeholderAnswers = randomizedQuestions.map(q => ({
        attempt_id: attempt.id,
        question_id: q.id,
        user_answer: null,
        is_correct: false,
        points_awarded: 0,
        evaluation_reason: 'No answer provided.',
        created_at: new Date().toISOString()
      }));

      await supabaseAdmin.from('quiz_answers').upsert(placeholderAnswers, { onConflict: 'attempt_id, question_id' });
    }

    return NextResponse.json({
      attemptId: attempt?.id,
      questions: randomizedQuestions,
      startedAt: attempt?.started_at,
      warning: fallbackWarning,
    });

  } catch (error: any) {
    console.error('Start quiz error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
