import { NextRequest, NextResponse } from 'next/server';
import { extractKeywordsFromResumeAndJD } from '@/lib/ai-interview/extractor';
import { ExtractKeywordsInput } from '@/lib/ai-interview/types';
import { requireAdminUser } from '@/lib/supabase/admin';

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
        payload.resumeMimeType = resumeFile.type || 'application/octet-stream';
        const buffer = await resumeFile.arrayBuffer();
        
        if (
          resumeFile.type.startsWith('text/') ||
          resumeFile.name.endsWith('.txt') ||
          resumeFile.name.endsWith('.md')
        ) {
          payload.resumeText = (payload.resumeText || '') + '\n' + new TextDecoder().decode(buffer);
        } else {
          payload.resumeFileBase64 = Buffer.from(buffer).toString('base64');
        }
      }

      const jdFile = formData.get('jdFile') as File | null;
      if (jdFile && jdFile.size > 0) {
        payload.jdFileName = jdFile.name;
        payload.jdMimeType = jdFile.type || 'application/octet-stream';
        const buffer = await jdFile.arrayBuffer();

        if (
          jdFile.type.startsWith('text/') ||
          jdFile.name.endsWith('.txt') ||
          jdFile.name.endsWith('.md')
        ) {
          payload.jdText = (payload.jdText || '') + '\n' + new TextDecoder().decode(buffer);
        } else {
          payload.jdFileBase64 = Buffer.from(buffer).toString('base64');
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
