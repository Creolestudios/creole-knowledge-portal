import { GoogleGenAI } from '@google/genai';
import { ExtractKeywordsInput, ExtractionResult } from './types';

// Curated technical and professional skills recognized in resumes & JDs
const KNOWN_TECHNICAL_SKILLS = new Set([
  'react', 'react.js', 'reactjs', 'next.js', 'nextjs', 'typescript', 'javascript',
  'node.js', 'nodejs', 'node', 'python', 'java', 'c++', 'c#', 'golang', 'go', 'rust',
  'ruby', 'php', 'swift', 'kotlin', 'html', 'html5', 'css', 'css3', 'tailwind',
  'tailwindcss', 'bootstrap', 'sass', 'scss', 'sql', 'mysql', 'postgresql', 'postgres',
  'mongodb', 'redis', 'sqlite', 'oracle', 'nosql', 'graphql', 'rest', 'restful',
  'api', 'apis', 'docker', 'kubernetes', 'aws', 'azure', 'gcp', 'cloud', 'git',
  'github', 'gitlab', 'ci/cd', 'cicd', 'jenkins', 'terraform', 'ansible', 'linux',
  'bash', 'agile', 'scrum', 'jira', 'tdd', 'unit testing', 'jest', 'vitest',
  'cypress', 'playwright', 'selenium', 'redux', 'zustand', 'mobx', 'express',
  'express.js', 'fastapi', 'django', 'flask', 'spring', 'spring boot',
  'microservices', 'kafka', 'rabbitmq', 'elasticsearch', 'figma', 'ui/ux',
  'devops', 'machine learning', 'ai', 'deep learning', 'nlp', 'pytorch',
  'tensorflow', 'pandas', 'numpy', 'web3', 'solidity', 'blockchain',
  'communication', 'leadership', 'problem solving', 'teamwork', 'critical thinking'
]);

// Common English stopwords and document markup noise to ignore
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'content', 'types', 'xml', 'doc', 'docx', 'pdf',
  'schema', 'http', 'https', 'org', 'com', 'rels', 'w3', 'xmlns', 'pkg',
  'document', 'true', 'false', 'null', 'undefined', 'let', 'var', 'const', 'from',
  'into', 'that', 'this', 'these', 'those', 'have', 'has', 'had', 'been', 'were',
  'was', 'are', 'is', 'you', 'your', 'our', 'my', 'their', 'them', 'they', 'she',
  'her', 'him', 'his', 'who', 'what', 'which', 'when', 'where', 'why', 'how',
  'any', 'all', 'some', 'not', 'but', 'also', 'only', 'more', 'most', 'very',
  'can', 'could', 'will', 'would', 'should', 'may', 'might', 'must', 'about',
  'above', 'after', 'again', 'against', 'between', 'down', 'during', 'each', 'few',
  'other', 'same', 'such', 'than', 'too', 'under', 'until', 'while', 'then', 'once',
  'here', 'there', 'both', 'below', 'off', 'out', 'over', 'own', 'just', 'now',
  'sample', 'resume', 'description', 'role', 'job', 'experience', 'skills',
  'work', 'years', 'required', 'responsibilities', 'qualifications', 'requirements',
  'seeking', 'looking', 'candidate', 'position', 'strong', 'ability', 'proficient'
]);

/**
 * Safely extracts human-readable text from binary buffers (DOCX, PDF, or text).
 * Prevents raw binary zip/deflate bytes from polluting keyword extraction.
 */
export function extractTextFromDocumentBuffer(
  buffer: Buffer,
  fileName?: string,
  mimeType?: string,
): string {
  const isDocx =
    (fileName && /\.docx$/i.test(fileName)) ||
    (mimeType && mimeType.includes('wordprocessingml')) ||
    (buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b);

  if (isDocx) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const AdmZip = require('adm-zip');
      const zip = new AdmZip(buffer);
      const docEntry = zip.getEntry('word/document.xml');
      if (docEntry) {
        const xml = docEntry.getData().toString('utf8');
        return xml
          .replaceAll('</w:p>', '\n')
          .replace(/<[^>]+>/g, ' ')
          .replaceAll('&amp;', '&')
          .replaceAll('&lt;', '<')
          .replaceAll('&gt;', '>')
          .replaceAll('&quot;', '"')
          .replaceAll('&apos;', "'")
          .replace(/\s+/g, ' ')
          .trim();
      }
    } catch (e) {
      console.warn('[extractTextFromDocumentBuffer] DOCX parse error:', e);
    }
  }

  const isPdf =
    (fileName && /\.pdf$/i.test(fileName)) ||
    (mimeType && mimeType.includes('pdf')) ||
    (buffer.length > 4 && buffer.subarray(0, 4).toString() === '%PDF');

  if (isPdf) {
    try {
      const raw = buffer.toString('latin1');
      let extracted = '';

      // 1. Try decompressing FlateDecode streams
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const zlib = require('zlib');
      const streamRegex = /stream[\r\n]+([\s\S]*?)[\r\n]+endstream/g;
      let match: RegExpExecArray | null;
      while ((match = streamRegex.exec(raw)) !== null) {
        try {
          const streamBuf = Buffer.from(match[1], 'latin1');
          const decompressed = zlib.inflateSync(streamBuf).toString('latin1');
          const tjMatches = decompressed.match(/\(([^)]+)\)\s*T[jJ]/g);
          if (tjMatches) {
            extracted += ' ' + tjMatches.map((m: string) => m.replaceAll('(', '').replaceAll(')', '').replace(/T[jJ]/, '')).join(' ');
          }
        } catch {
          // Stream is not flate-compressed or failed to inflate; skip
        }
      }

      // 2. Uncompressed Tj / TJ
      const directMatches = raw.match(/\(([^)]+)\)\s*T[jJ]/g);
      if (directMatches) {
        extracted += ' ' + directMatches.map((m: string) => m.replaceAll('(', '').replaceAll(')', '').replace(/T[jJ]/, '')).join(' ');
      }

      const cleaned = extracted.replace(/\s+/g, ' ').trim();
      if (cleaned.length > 20) {
        return cleaned;
      }
    } catch (e) {
      console.warn('[extractTextFromDocumentBuffer] PDF parse error:', e);
    }
  }

  // Fallback: check if ASCII/UTF8 plain text
  try {
    const utf8 = buffer.toString('utf8');
    const printableMatches = utf8.match(/[\x20-\x7E\r\n\t]/g);
    const printableRatio = (printableMatches ? printableMatches.length : 0) / (utf8.length || 1);
    if (printableRatio > 0.85) {
      return utf8.trim();
    }
  } catch {
    // ignore
  }

  return '';
}

/**
 * Fallback heuristic keyword matcher for offline/testing when Gemini is unavailable.
 */
export function extractKeywordsLocalFallback(
  resumeText: string,
  jdText: string
): ExtractionResult {
  const stripDotsAndPunctuation = (word: string) => {
    const noPunctuation = word.replace(/[,;:!?]/g, '');
    let start = 0;
    let end = noPunctuation.length;
    while (start < end && noPunctuation[start] === '.') start++;
    while (end > start && noPunctuation[end - 1] === '.') end--;
    return noPunctuation.slice(start, end);
  };

  const clean = (text: string) =>
    text
      .toLowerCase()
      .replace(/[^a-z0-9+#.\s]/g, ' ')
      .split(/\s+/)
      .map(stripDotsAndPunctuation)
      .filter((w) => {
        if (w.length < 2) return false;
        if (STOPWORDS.has(w)) return false;
        // Keep 2-letter tokens only if known abbreviation or skill
        if (w.length === 2 && !['ai', 'go', 'c#', 'c++', 'js', 'ts', 'qa', 'ml', 'ui', 'ux', 'db', 'ci', 'cd'].includes(w)) {
          return false;
        }
        // Filter random symbols or tokens starting with # or +
        if ((w.startsWith('#') || w.startsWith('+')) && !['c++', 'c#'].includes(w)) {
          return false;
        }
        // Words without vowels unless known abbreviation or skill
        if (!/[aeiouy]/.test(w) && !KNOWN_TECHNICAL_SKILLS.has(w)) {
          return false;
        }
        // Filter random hexadecimal / byte fragments like f7, 8y, zy, mm, 9dn, rguq
        if (/^[a-z0-9]{1,3}[0-9][a-z0-9]*$/.test(w) && !['c++', 'c#', 'html5', 'css3', 'web3', 'oauth2'].includes(w)) {
          return false;
        }
        // Filter random 4+ consonant clusters or non-skill garbage
        if (!KNOWN_TECHNICAL_SKILLS.has(w) && (/[^aeiouy]{4,}/.test(w) || w === 'rguq')) {
          return false;
        }
        return true;
      });

  const resumeWords = Array.from(new Set(clean(resumeText)));
  const jdWords = Array.from(new Set(clean(jdText)));
  const resumeWordSet = new Set(resumeWords);

  // Prioritize known technical skills first, then other meaningful words
  const sortSkills = (words: string[]) =>
    [...words].sort((a, b) => {
      const aKnown = KNOWN_TECHNICAL_SKILLS.has(a) ? 1 : 0;
      const bKnown = KNOWN_TECHNICAL_SKILLS.has(b) ? 1 : 0;
      if (aKnown !== bKnown) return bKnown - aKnown;
      return b.length - a.length;
    });

  const matched = sortSkills(jdWords.filter((w) => resumeWordSet.has(w)));
  const missing = sortSkills(jdWords.filter((w) => !resumeWordSet.has(w)));

  const totalJd = jdWords.length || 1;
  const matchPct = Math.min(100, Math.max(0, Math.round((matched.length / totalJd) * 100)));

  // Sanitize summary if binary noise
  let summary = resumeText.slice(0, 300);
  if (/PK\s|Content_Types|\.xml|[^\x20-\x7E\r\n\t]{3,}/i.test(summary)) {
    summary = matched.length > 0
      ? `Candidate with competencies in ${matched.slice(0, 6).join(', ')}.`
      : 'Resume content processed.';
  }

  return {
    candidateProfile: {
      summary: summary || 'Resume content processed.',
      extractedSkills: sortSkills(resumeWords).slice(0, 15),
      domains: ['Engineering'],
      yearsOfExperience: 0,
    },
    jdRequirements: {
      mustHaveSkills: sortSkills(jdWords).slice(0, 10),
      niceToHaveSkills: sortSkills(jdWords).slice(10, 15),
      keyResponsibilities: ['Fulfill role objectives based on provided JD.'],
    },
    analysis: {
      matchPercentage: matchPct,
      matchedKeywords: matched.slice(0, 20),
      missingKeywords: missing.slice(0, 20),
      resumeOnlyKeywords: sortSkills(resumeWords.filter((w) => !jdWords.includes(w))).slice(0, 15),
      skillGapSummary: missing.length > 0 
        ? `Missing ${missing.length} keywords identified in JD.` 
        : 'Strong alignment with JD requirements.',
      keyStrengths: matched.slice(0, 5),
      improvementAreas: missing.slice(0, 5),
      apiFailed: true,
      apiNote: 'Note: AI keyword extraction API is not working or unavailable. Fallback parser extracted basic keywords. Please retry.',
    },
    isFallback: true,
    apiFailed: true,
    apiNote: 'Note: AI keyword extraction API is not working or unavailable. Fallback parser extracted basic keywords. Please retry.',
    extractedAt: new Date().toISOString(),
  };
}

function normalizeMatchPercentage(
  rawScore: unknown,
  matchedKeywords: string[],
  missingKeywords: string[]
): number {
  const parsedScore = typeof rawScore === 'number'
    ? rawScore
    : Number.parseFloat(String(rawScore).replace('%', '').trim());

  if (Number.isFinite(parsedScore) && parsedScore > 0) {
    return Math.max(0, Math.min(100, parsedScore));
  }

  if (matchedKeywords.length > 0 && missingKeywords.length === 0) {
    return 100;
  }

  const totalKeywords = matchedKeywords.length + missingKeywords.length;
  return totalKeywords > 0
    ? Math.round((matchedKeywords.length / totalKeywords) * 100)
    : 0;
}

/**
 * Extracts keywords, candidate profile, JD requirements, and match analysis using Gemini AI.
 */
export async function extractKeywordsFromResumeAndJD(
  input: ExtractKeywordsInput
): Promise<ExtractionResult> {
  const apiKey = process.env.GEMINI_API_KEY;

  const resumeText = input.resumeText?.trim() || '';
  const jdText = input.jdText?.trim() || '';

  if (!resumeText && !input.resumeFileBase64) {
    throw new Error('Resume text or file content is required.');
  }
  if (!jdText && !input.jdFileBase64) {
    throw new Error('Job Description (JD) text or file content is required.');
  }

  if (!apiKey) {
    console.warn('[AI Interview Extractor] GEMINI_API_KEY missing. Using fallback parser.');
    const fallback = extractKeywordsLocalFallback(resumeText || 'Sample Resume', jdText || 'Sample JD');
    const missingKeyNote = 'Note: AI keyword extraction API is not working because GEMINI_API_KEY is not configured. Showing 0 or fallback keywords. Please configure the API key and retry.';
    return {
      ...fallback,
      isFallback: true,
      apiFailed: true,
      apiNote: missingKeyNote,
      analysis: {
        ...fallback.analysis,
        apiFailed: true,
        apiNote: missingKeyNote,
      },
    };
  }

  const ai = new GoogleGenAI({ apiKey });

  const prompt = `
You are an expert HR Tech & AI Technical Recruiter.
Analyze the provided Resume and Job Description (JD) and extract structured keyword and skill alignment metadata.

CRITICAL INSTRUCTION #1: DOCUMENT TYPE CLASSIFICATION & VALIDATION
Before analyzing anything else, you MUST check the document explicitly labeled "UPLOADED IN 'RESUME' FIELD" and the document explicitly labeled "UPLOADED IN 'JOB DESCRIPTION' FIELD".
- A valid Resume contains an individual's personal work history, education, skills, and contact information.
- A valid Job Description contains a company's hiring requirements, "We are looking for...", required qualifications, and role responsibilities.
You must handle these 3 error scenarios specifically and return the exact corresponding string in "documentValidationWarning":
1. If the document labeled "UPLOADED IN 'RESUME' FIELD" AND the document labeled "UPLOADED IN 'JOB DESCRIPTION' FIELD" BOTH appear to be Resumes: "Please add a valid Job Description. It appears you have uploaded two Resumes."
2. If the document labeled "UPLOADED IN 'RESUME' FIELD" AND the document labeled "UPLOADED IN 'JOB DESCRIPTION' FIELD" BOTH appear to be Job Descriptions: "Please add a valid candidate Resume. It appears you have uploaded two Job Descriptions."
3. If the document labeled "UPLOADED IN 'RESUME' FIELD" is actually a Job Description AND the document labeled "UPLOADED IN 'JOB DESCRIPTION' FIELD" is actually a Resume: "Please add the Resume and Job Description (JD) in the correct places. It appears they have been swapped."
If none of these errors apply and both documents are correctly classified, leave "documentValidationWarning" as null.

CRITICAL INSTRUCTION #2: EXTRACTION
1. Extract technical skills, soft skills, tools, frameworks, and domain keywords from both documents.
2. Calculate an accurate matchPercentage (0 to 100) based on how well candidate experience & keywords cover the JD requirements. 
3. Identify matchedKeywords, missingKeywords (JD requirements missing from Resume), and resumeOnlyKeywords.
4. Provide a clear skillGapSummary, candidate keyStrengths, and improvementAreas.
5. Extract HR screening details when explicitly present in the resume. Include school results such as 10th/SSC and 12th/HSC percentage, CGPA, grade, and passing year. Never infer or calculate an academic result that is not stated.

Output format requirement:
Respond ONLY with valid JSON conforming strictly to this structure without markdown wraps:
{
  "documentValidationWarning": "string or null (Evaluate this FIRST before extracting anything else)",
  "candidateProfile": {
    "name": "string or null",
    "email": "string or null",
    "yearsOfExperience": number or 0,
    "summary": "short profile summary",
    "extractedSkills": ["string"],
    "domains": ["string"],
    "education": [
      {
        "level": "school | college | postgraduate | other",
        "institution": "string or null",
        "qualification": "string or null (for example: 10th, 12th, SSC, HSC)",
        "fieldOfStudy": "string or null",
        "percentage": "number or null",
        "cgpa": "number or null",
        "grade": "string or null",
        "passingYear": "number or null"
      }
    ],
    "noticePeriod": "string or null",
    "currentLocation": "string or null",
    "availability": "string or null",
    "workAuthorization": "string or null",
    "projectHighlights": ["string"]
  },
  "jdRequirements": {
    "jobTitle": "string or null",
    "seniorityLevel": "string or null",
    "requiredExperienceYears": number or 0,
    "mustHaveSkills": ["string"],
    "niceToHaveSkills": ["string"],
    "keyResponsibilities": ["string"]
  },
  "analysis": {
    "matchPercentage": number,
    "matchedKeywords": ["string"],
    "missingKeywords": ["string"],
    "resumeOnlyKeywords": ["string"],
    "skillGapSummary": "string",
    "keyStrengths": ["string"],
    "improvementAreas": ["string"]
  }
}

--- TEXT UPLOADED IN "RESUME" FIELD ---
${resumeText || '(See attached Resume file)'}

--- TEXT UPLOADED IN "JOB DESCRIPTION" FIELD ---
${jdText || '(See attached JD file)'}
`.trim();

  const contents: any[] = [];

  if (input.resumeFileBase64 && input.resumeMimeType) {
    contents.push({ text: '--- DOCUMENT UPLOADED IN "RESUME" FIELD ---' });
    contents.push({
      inlineData: {
        mimeType: input.resumeMimeType,
        data: input.resumeFileBase64,
      },
    });
  }

  if (input.jdFileBase64 && input.jdMimeType) {
    contents.push({ text: '--- DOCUMENT UPLOADED IN "JOB DESCRIPTION" FIELD ---' });
    contents.push({
      inlineData: {
        mimeType: input.jdMimeType,
        data: input.jdFileBase64,
      },
    });
  }

  contents.push(prompt);

  const modelsToTry = [
    ...(process.env.GEMINI_MODEL ? [process.env.GEMINI_MODEL] : []),
    'gemini-3.5-flash-lite',
    'gemini-flash-lite-latest',
    'gemini-2.5-flash',
    'gemini-3.5-flash',
    'gemini-3.8-flash',
    'gemini-3.1-flash-lite',
  ];
  const maxAttemptsPerModel = 2;

  modelLoop: for (const modelName of modelsToTry) {
    for (let attempt = 1; attempt <= maxAttemptsPerModel; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model: modelName,
          contents,
          config: {
            responseMimeType: 'application/json',
          },
        });

        if (response && response.text) {
          let rawText = response.text.trim();
          const jsonMatch = rawText.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            rawText = jsonMatch[0];
          }

          const parsed = JSON.parse(rawText);

          return {
            candidateProfile: {
              name: parsed.candidateProfile?.name || undefined,
              email: parsed.candidateProfile?.email || undefined,
              yearsOfExperience: Number(parsed.candidateProfile?.yearsOfExperience) || 0,
              summary: parsed.candidateProfile?.summary || '',
              extractedSkills: Array.isArray(parsed.candidateProfile?.extractedSkills)
                ? parsed.candidateProfile.extractedSkills
                : [],
              domains: Array.isArray(parsed.candidateProfile?.domains)
                ? parsed.candidateProfile.domains
                : [],
              education: Array.isArray(parsed.candidateProfile?.education)
                ? parsed.candidateProfile.education.map((record: Record<string, unknown>) => ({
                    level: ['school', 'college', 'postgraduate', 'other'].includes(String(record.level))
                      ? record.level as 'school' | 'college' | 'postgraduate' | 'other'
                      : 'other',
                    institution: typeof record.institution === 'string' ? record.institution : undefined,
                    qualification: typeof record.qualification === 'string' ? record.qualification : undefined,
                    fieldOfStudy: typeof record.fieldOfStudy === 'string' ? record.fieldOfStudy : undefined,
                    percentage: typeof record.percentage === 'number' ? record.percentage : undefined,
                    cgpa: typeof record.cgpa === 'number' ? record.cgpa : undefined,
                    grade: typeof record.grade === 'string' ? record.grade : undefined,
                    passingYear: typeof record.passingYear === 'number' ? record.passingYear : undefined,
                  }))
                : [],
              noticePeriod: parsed.candidateProfile?.noticePeriod || undefined,
              currentLocation: parsed.candidateProfile?.currentLocation || undefined,
              availability: parsed.candidateProfile?.availability || undefined,
              workAuthorization: parsed.candidateProfile?.workAuthorization || undefined,
              projectHighlights: Array.isArray(parsed.candidateProfile?.projectHighlights)
                ? parsed.candidateProfile.projectHighlights
                : [],
            },
            jdRequirements: {
              jobTitle: parsed.jdRequirements?.jobTitle || undefined,
              seniorityLevel: parsed.jdRequirements?.seniorityLevel || undefined,
              requiredExperienceYears: Number(parsed.jdRequirements?.requiredExperienceYears) || 0,
              mustHaveSkills: Array.isArray(parsed.jdRequirements?.mustHaveSkills)
                ? parsed.jdRequirements.mustHaveSkills
                : [],
              niceToHaveSkills: Array.isArray(parsed.jdRequirements?.niceToHaveSkills)
                ? parsed.jdRequirements.niceToHaveSkills
                : [],
              keyResponsibilities: Array.isArray(parsed.jdRequirements?.keyResponsibilities)
                ? parsed.jdRequirements.keyResponsibilities
                : [],
            },
            analysis: (() => {
              const matchedKws = Array.isArray(parsed.analysis?.matchedKeywords)
                ? parsed.analysis.matchedKeywords
                : [];
              const missingKws = Array.isArray(parsed.analysis?.missingKeywords)
                ? parsed.analysis.missingKeywords
                : [];
              const normalizedScore = normalizeMatchPercentage(
                parsed.analysis?.matchPercentage,
                matchedKws,
                missingKws
              );
              const isZeroKeywords = matchedKws.length === 0 && normalizedScore === 0;
              const zeroNote = isZeroKeywords
                ? 'Note: AI keyword extraction API is not working or returned 0 keywords. Please verify document contents and retry.'
                : undefined;

              return {
                matchPercentage: normalizedScore,
                matchedKeywords: matchedKws,
                missingKeywords: missingKws,
                resumeOnlyKeywords: Array.isArray(parsed.analysis?.resumeOnlyKeywords)
                  ? parsed.analysis.resumeOnlyKeywords
                  : [],
                skillGapSummary: parsed.analysis?.skillGapSummary || '',
                keyStrengths: Array.isArray(parsed.analysis?.keyStrengths)
                  ? parsed.analysis.keyStrengths
                  : [],
                improvementAreas: Array.isArray(parsed.analysis?.improvementAreas)
                  ? parsed.analysis.improvementAreas
                  : [],
                documentValidationWarning: parsed.documentValidationWarning || parsed.analysis?.documentValidationWarning || undefined,
                apiFailed: isZeroKeywords,
                apiNote: zeroNote,
              };
            })(),
            apiFailed:
              (!Array.isArray(parsed.analysis?.matchedKeywords) || parsed.analysis.matchedKeywords.length === 0) &&
              normalizeMatchPercentage(
                parsed.analysis?.matchPercentage,
                Array.isArray(parsed.analysis?.matchedKeywords) ? parsed.analysis.matchedKeywords : [],
                Array.isArray(parsed.analysis?.missingKeywords) ? parsed.analysis.missingKeywords : []
              ) === 0,
            apiNote:
              (!Array.isArray(parsed.analysis?.matchedKeywords) || parsed.analysis.matchedKeywords.length === 0) &&
              normalizeMatchPercentage(
                parsed.analysis?.matchPercentage,
                Array.isArray(parsed.analysis?.matchedKeywords) ? parsed.analysis.matchedKeywords : [],
                Array.isArray(parsed.analysis?.missingKeywords) ? parsed.analysis.missingKeywords : []
              ) === 0
                ? 'Note: AI keyword extraction API is not working or returned 0 keywords. Please verify document contents and retry.'
                : undefined,
            extractedAt: new Date().toISOString(),
          };
        }
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);

        const isQuotaExhausted =
          errMsg.includes('429') ||
          errMsg.includes('RESOURCE_EXHAUSTED') ||
          errMsg.includes('quota');

        if (isQuotaExhausted) {
          console.warn(`[AI Interview Extractor] Gemini model ${modelName} daily quota exhausted. Trying next model...`);
          break; // break attempt loop to try next model in modelLoop
        }

        const isSkipModel =
          errMsg.includes('404') ||
          errMsg.includes('NOT_FOUND') ||
          errMsg.includes('no longer available') ||
          errMsg.includes('fetch failed') ||
          errMsg.includes('Failed to fetch') ||
          errMsg.includes('ENOTFOUND') ||
          errMsg.includes('ECONNREFUSED');

        const isTransient =
          !isSkipModel &&
          (errMsg.includes('500') ||
            errMsg.includes('503') ||
            errMsg.includes('INTERNAL') ||
            errMsg.includes('UNAVAILABLE') ||
            errMsg.includes('demand') ||
            errMsg.includes('wsarecv') ||
            errMsg.includes('ECONNRESET') ||
            errMsg.includes('stream reading error') ||
            errMsg.includes('forcibly closed') ||
            errMsg.includes('connection reset'));

        console.warn(
          `[AI Interview Extractor] Model ${modelName} failed (attempt ${attempt}/${maxAttemptsPerModel}):`,
          err
        );

        if (isSkipModel) {
          break;
        }

        if (isTransient && attempt < maxAttemptsPerModel) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
          continue;
        }

        break;
      }
    }
  }

  console.warn('[AI Interview Extractor] Using local keyword fallback parser.');
  // If resume or JD text is missing because a binary file (PDF/DOCX) was uploaded,
  // extract clean human-readable text from base64 buffer so fallback can extract real candidate skills.
  let effectiveResumeText = resumeText;
  if (!effectiveResumeText && input.resumeFileBase64) {
    try {
      const buf = Buffer.from(input.resumeFileBase64, 'base64');
      effectiveResumeText = extractTextFromDocumentBuffer(buf, input.resumeFileName, input.resumeMimeType);
    } catch {
      effectiveResumeText = 'Resume';
    }
  }

  let effectiveJdText = jdText;
  if (!effectiveJdText && input.jdFileBase64) {
    try {
      const buf = Buffer.from(input.jdFileBase64, 'base64');
      effectiveJdText = extractTextFromDocumentBuffer(buf, input.jdFileName, input.jdMimeType);
    } catch {
      effectiveJdText = 'JD';
    }
  }

  const fallback = extractKeywordsLocalFallback(effectiveResumeText || 'Resume', effectiveJdText || 'JD');
  const failureNote = 'Note: AI keyword extraction API is unavailable (daily quota exhausted or network limit). Fallback parser extracted keywords from documents.';
  return {
    ...fallback,
    isFallback: true,
    apiFailed: true,
    apiNote: failureNote,
    analysis: {
      ...fallback.analysis,
      apiFailed: true,
      apiNote: failureNote,
    },
  };
}
