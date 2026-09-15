---
title: 'AI Interview: Resume & JD Keyword Extractor Module'
tags: [ai-interview, keywords, resume, jd, assessment, extractor]
created: 2026-09-11
updated: 2026-09-11
---

# AI Interview: Resume & Job Description Keyword Extractor Module

> **Status:** Implemented & Verified

## Overview

The **AI Interview Resume & JD Keyword Extractor Module** allows administrators and technical recruiters to upload or paste a candidate resume alongside a Job Description (JD) to extract technical keywords, compute alignment match percentage, categorize skills (matched vs missing/gaps), and provide AI-generated interview recommendations.

---

## Key Features

1. **Dual Input Support**:
   - Accepts PDF, DOCX, TXT file uploads up to 10MB.
   - Accepts direct plain text copy-paste.
2. **AI Keyword & Skill Taxonomy Extraction**:
   - Extracts candidate profile (name, experience level, extracted skills, project highlights).
   - Extracts JD requirements (must-have skills, nice-to-have skills, required YOE).
   - Categorizes skills into:
     - **Matched Keywords**: Skills present in both Resume & JD.
     - **Missing / Skill Gaps**: Mandatory JD skills not found in candidate resume.
     - **Resume-Only Strengths**: Bonus skills provided by the candidate.
3. **Candidate-to-JD Match Score**:
   - Calculates a 0-100% alignment rating based on keyword coverage and experience level.
4. **Actionable Recommendations**:
   - Highlights core candidate strengths and recommended interview focus areas for missing skills.

---

## File Architecture

| Component | Path | Description |
|---|---|---|
| **Types** | `lib/ai-interview/types.ts` | TypeScript interfaces for upload payloads, candidate profile, JD requirements, and extraction results. |
| **Extractor Service** | `lib/ai-interview/extractor.ts` | Google Gemini AI integration (`gemini-2.5-flash` with local fallback matcher). |
| **Unit Tests** | `lib/ai-interview/extractor.test.ts` | Vitest test suite for keyword extraction and fallback parsing. |
| **API Route** | `app/api/ai-interview/extract/route.ts` | POST endpoint supporting JSON and `multipart/form-data`. |
| **API Tests** | `app/api/ai-interview/extract/route.test.ts` | Vitest test suite for API endpoint validation. |
| **Uploader Component** | `components/ai-interview/resume-jd-uploader.tsx` | Drag-and-drop file upload & text paste UI. |
| **Results Component** | `components/ai-interview/keyword-results.tsx` | Dashboard displaying match score, categorized keywords, and report export. |
| **Page View** | `app/dashboard/ai-interview/extractor/page.tsx` | Next.js 15 App Router page view. |

---

## API Documentation

### `POST /api/ai-interview/extract`

#### Request Payload (`multipart/form-data` or `application/json`)
```json
{
  "resumeText": "Fullstack Engineer React TypeScript Node.js",
  "jdText": "Senior Frontend Developer React TypeScript Next.js"
}
```

#### Response Payload (`ExtractionResult`)
```json
{
  "candidateProfile": {
    "yearsOfExperience": 5,
    "summary": "Fullstack Engineer...",
    "extractedSkills": ["React", "TypeScript", "Node.js"],
    "domains": ["Frontend", "Backend"]
  },
  "jdRequirements": {
    "jobTitle": "Senior Frontend Developer",
    "mustHaveSkills": ["React", "TypeScript", "Next.js"],
    "niceToHaveSkills": ["Tailwind CSS"]
  },
  "analysis": {
    "matchPercentage": 75,
    "matchedKeywords": ["React", "TypeScript"],
    "missingKeywords": ["Next.js"],
    "resumeOnlyKeywords": ["Node.js"],
    "skillGapSummary": "Missing Next.js experience",
    "keyStrengths": ["Strong TypeScript background"],
    "improvementAreas": ["Assess Next.js familiarity"]
  },
  "extractedAt": "2026-09-11T18:45:00.000Z"
}
```
