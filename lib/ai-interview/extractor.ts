import { GoogleGenAI } from '@google/genai';
import { ExtractKeywordsInput, ExtractionResult } from './types';

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
      .filter((w) => w.length >= 2);

  const resumeWords = new Set(clean(resumeText));
  const jdWords = Array.from(new Set(clean(jdText)));

  const matched = jdWords.filter((w) => resumeWords.has(w));
  const missing = jdWords.filter((w) => !resumeWords.has(w));

  const totalJd = jdWords.length || 1;
  const matchPct = Math.round((matched.length / totalJd) * 100);

  return {
    candidateProfile: {
      summary: resumeText.slice(0, 300) || 'Resume content processed.',
      extractedSkills: Array.from(resumeWords).slice(0, 15),
      domains: ['Engineering'],
      yearsOfExperience: 0,
    },
    jdRequirements: {
      mustHaveSkills: jdWords.slice(0, 10),
      niceToHaveSkills: jdWords.slice(10, 15),
      keyResponsibilities: ['Fulfill role objectives based on provided JD.'],
    },
    analysis: {
      matchPercentage: matchPct,
      matchedKeywords: matched.slice(0, 20),
      missingKeywords: missing.slice(0, 20),
      resumeOnlyKeywords: Array.from(resumeWords)
        .filter((w) => !jdWords.includes(w))
        .slice(0, 15),
      skillGapSummary: missing.length > 0 
        ? `Missing ${missing.length} keywords identified in JD.` 
        : 'Strong alignment with JD requirements.',
      keyStrengths: matched.slice(0, 5),
      improvementAreas: missing.slice(0, 5),
    },
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
    return extractKeywordsLocalFallback(resumeText || 'Sample Resume', jdText || 'Sample JD');
  }

  const ai = new GoogleGenAI({ apiKey });

  const prompt = `
You are an expert HR Tech & AI Technical Recruiter.
Analyze the provided Resume and Job Description (JD) and extract structured keyword and skill alignment metadata.

CRITICAL INSTRUCTIONS:
1. Extract technical skills, soft skills, tools, frameworks, and domain keywords from both documents.
2. Calculate an accurate matchPercentage (0 to 100) based on how well candidate experience & keywords cover the JD requirements.
3. Identify matchedKeywords, missingKeywords (JD requirements missing from Resume), and resumeOnlyKeywords.
4. Provide a clear skillGapSummary, candidate keyStrengths, and improvementAreas.
5. Extract HR screening details when explicitly present in the resume. Include school results such as 10th/SSC and 12th/HSC percentage, CGPA, grade, and passing year. Never infer or calculate an academic result that is not stated.

Output format requirement:
Respond ONLY with valid JSON conforming strictly to this structure without markdown wraps:
{
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

Resume Content:
${resumeText || '(See attached Resume file)'}

Job Description Content:
${jdText || '(See attached JD file)'}
`.trim();

  const contents: any[] = [];

  if (input.resumeFileBase64 && input.resumeMimeType) {
    contents.push({
      inlineData: {
        mimeType: input.resumeMimeType,
        data: input.resumeFileBase64,
      },
    });
  }

  if (input.jdFileBase64 && input.jdMimeType) {
    contents.push({
      inlineData: {
        mimeType: input.jdMimeType,
        data: input.jdFileBase64,
      },
    });
  }

  contents.push(prompt);

  const modelsToTry = ['gemini-2.5-flash', 'gemini-3.6-flash'];

  for (const modelName of modelsToTry) {
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
        const firstBrace = rawText.indexOf('{');
        const lastBrace = rawText.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
          rawText = rawText.slice(firstBrace, lastBrace + 1);
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
          analysis: {
            matchPercentage: normalizeMatchPercentage(
              parsed.analysis?.matchPercentage,
              Array.isArray(parsed.analysis?.matchedKeywords) ? parsed.analysis.matchedKeywords : [],
              Array.isArray(parsed.analysis?.missingKeywords) ? parsed.analysis.missingKeywords : []
            ),
            matchedKeywords: Array.isArray(parsed.analysis?.matchedKeywords)
              ? parsed.analysis.matchedKeywords
              : [],
            missingKeywords: Array.isArray(parsed.analysis?.missingKeywords)
              ? parsed.analysis.missingKeywords
              : [],
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
          },
          extractedAt: new Date().toISOString(),
        };
      }
    } catch (err) {
      console.warn(`[AI Interview Extractor] Model ${modelName} failed:`, err);
    }
  }

  // Fallback if AI calls fail
  return extractKeywordsLocalFallback(resumeText || 'Resume', jdText || 'JD');
}
