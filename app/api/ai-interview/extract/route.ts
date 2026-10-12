import { NextRequest, NextResponse } from 'next/server';
import { extractKeywordsFromResumeAndJD, extractTextFromDocumentBuffer } from '@/lib/ai-interview/extractor';
import { ExtractKeywordsInput } from '@/lib/ai-interview/types';
import { requireAdminUser } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function isSuspiciousPayload(text: string): boolean {
  if (!text) return false;
  
  // Check 1: Is it raw JSON?
  const trimmed = text.trim();
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      JSON.parse(trimmed);
      return true; // It's purely JSON data
    } catch (e) {
      // Not valid JSON, continue
    }
  }

  // Check 2: Does it contain script tags or suspicious HTML wrappers?
  const lowerText = text.toLowerCase();
  if (lowerText.includes('<script') || lowerText.includes('type="application/ld+json"')) {
    return true;
  }

  // Check 3: Is it heavily HTML-formatted rather than natural text?
  const htmlTagMatches = text.match(/<[^>]+>/g);
  if (htmlTagMatches && htmlTagMatches.length > 15 && htmlTagMatches.length > text.split(/\s+/).length / 3) {
    return true; // Too many HTML tags compared to words
  }

  return false;
}

export async function POST(req: NextRequest) {
  try {
    if (!(await requireAdminUser())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const contentType = req.headers.get('content-type') || '';
    const payload: ExtractKeywordsInput = {};

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();

      const resumeText = formData.get('resumeText') as string | null;
      const jdText = formData.get('jdText') as string | null;

      if (resumeText) payload.resumeText = resumeText;
      if (jdText) payload.jdText = jdText;

      const resumeFile = formData.get('resumeFile') as File | null;
      if (resumeFile && resumeFile.size > 0) {
        payload.resumeFileName = resumeFile.name;
        const isPdf = resumeFile.name.toLowerCase().endsWith('.pdf') || resumeFile.type === 'application/pdf';
        payload.resumeMimeType = isPdf ? 'application/pdf' : (resumeFile.type || 'application/octet-stream');
        const buffer = await resumeFile.arrayBuffer();
        const nodeBuffer = Buffer.from(buffer);

        if (
          resumeFile.type.startsWith('text/') ||
          resumeFile.name.endsWith('.txt') ||
          resumeFile.name.endsWith('.md')
        ) {
          payload.resumeText = (payload.resumeText || '') + '\n' + new TextDecoder().decode(buffer);
        } else {
          const extractedText = extractTextFromDocumentBuffer(nodeBuffer, resumeFile.name, payload.resumeMimeType);
          if (extractedText && extractedText.length > 20) {
            payload.resumeText = (payload.resumeText || '') + '\n' + extractedText;
          }
          if (isPdf) {
            payload.resumeFileBase64 = nodeBuffer.toString('base64');
          }
        }
      }

      const jdFile = formData.get('jdFile') as File | null;
      if (jdFile && jdFile.size > 0) {
        payload.jdFileName = jdFile.name;
        const isPdf = jdFile.name.toLowerCase().endsWith('.pdf') || jdFile.type === 'application/pdf';
        payload.jdMimeType = isPdf ? 'application/pdf' : (jdFile.type || 'application/octet-stream');
        const buffer = await jdFile.arrayBuffer();
        const nodeBuffer = Buffer.from(buffer);

        if (
          jdFile.type.startsWith('text/') ||
          jdFile.name.endsWith('.txt') ||
          jdFile.name.endsWith('.md')
        ) {
          payload.jdText = (payload.jdText || '') + '\n' + new TextDecoder().decode(buffer);
        } else {
          const extractedText = extractTextFromDocumentBuffer(nodeBuffer, jdFile.name, payload.jdMimeType);
          if (extractedText && extractedText.length > 20) {
            payload.jdText = (payload.jdText || '') + '\n' + extractedText;
          }
          if (isPdf) {
            payload.jdFileBase64 = nodeBuffer.toString('base64');
          }
        }
      }
    } else {
      const body = await req.json();
      payload.resumeText = body.resumeText;
      payload.jdText = body.jdText;
      payload.resumeFileName = body.resumeFileName;
      payload.jdFileName = body.jdFileName;
      payload.resumeFileBase64 = body.resumeFileBase64;
      payload.jdFileBase64 = body.jdFileBase64;
      payload.resumeMimeType = body.resumeMimeType;
      payload.jdMimeType = body.jdMimeType;
    }

    if (
      !payload.resumeText?.trim() &&
      !payload.resumeFileBase64 &&
      !payload.jdText?.trim() &&
      !payload.jdFileBase64
    ) {
      return NextResponse.json(
        { error: 'Please provide both Resume and Job Description content or files.' },
        { status: 400 }
      );
    }

    if (!payload.resumeText?.trim() && !payload.resumeFileBase64) {
      return NextResponse.json(
        { error: 'Resume content or file is missing.' },
        { status: 400 }
      );
    }

    if (!payload.jdText?.trim() && !payload.jdFileBase64) {
      return NextResponse.json(
        { error: 'Job Description content or file is missing.' },
        { status: 400 }
      );
    }

    if (payload.jdText && !payload.jdFileBase64) {
      const wordCount = payload.jdText.trim().split(/\s+/).length;
      if (wordCount < 3) {
        return NextResponse.json(
          { error: 'Job Description is too short. Please provide at least 3 words for accurate analysis.' },
          { status: 400 }
        );
      }
    }
    if (isSuspiciousPayload(payload.jdText || '') || isSuspiciousPayload(payload.resumeText || '')) {
      return NextResponse.json(
        { error: 'Invalid input format detected. Please provide a standard text Job Description or Resume, not code snippets, raw JSON, or raw HTML scripts.' },
        { status: 400 }
      );
    }

    const result = await extractKeywordsFromResumeAndJD(payload);

    if (result.analysis?.documentValidationWarning) {
      return NextResponse.json(
        { error: result.analysis.documentValidationWarning },
        { status: 400 }
      );
    }

    return NextResponse.json(result, { status: 200 });
  } catch (err: any) {
    console.error('[API /api/ai-interview/extract] Extraction error:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to extract keywords from provided inputs.' },
      { status: 500 }
    );
  }
}
