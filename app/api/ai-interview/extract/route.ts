import { NextRequest, NextResponse } from 'next/server';
import { extractKeywordsFromResumeAndJD, extractTextFromDocumentBuffer } from '@/lib/ai-interview/extractor';
import { ExtractKeywordsInput } from '@/lib/ai-interview/types';
import { requireAdminUser } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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

    const result = await extractKeywordsFromResumeAndJD(payload);

    return NextResponse.json(result, { status: 200 });
  } catch (err: any) {
    console.error('[API /api/ai-interview/extract] Extraction error:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to extract keywords from provided inputs.' },
      { status: 500 }
    );
  }
}
