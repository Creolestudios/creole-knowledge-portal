---
title: 'AI Interview Module'
tags: [ai-interview, interview, resume, jd, assessment]
created: 2026-09-11
updated: 2026-09-15
---

# AI Interview Module

> **Status:** Implemented & Verified

## Overview

The **AI Interview Module** allows administrators and technical recruiters to upload or paste a candidate resume alongside a Job Description (JD), analyze candidate-to-JD alignment, and dynamically generate tailored HR interview questions based on meeting duration.


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
4. **Generated HR Interview Questions UI**:
   - Displays the full list of **10+ generated HR & Behavioral questions** directly on the results dashboard.
   - Includes duration selector controls (15m, 20m, 30m [Default], 45m, 60m) with dynamic re-generation.
   - Provides a "Copy All Questions" button formatted with question numbers, intents, and time limits.

---

## File Architecture

| Component | Path | Description |
|---|---|---|
| **Types** | `lib/ai-interview/types.ts` | TypeScript interfaces for upload payloads, candidate profile, JD requirements, and extraction results. |
| **Extractor Service** | `lib/ai-interview/extractor.ts` | Google Gemini AI integration (`gemini-2.5-flash` with local fallback matcher). |
| **Question Generator** | `lib/ai-interview/question-generator.ts` | HR Question generator with custom selection and duration scaling. |
| **Object Detection Service** | `lib/ai-interview/object-detection.ts` | Rules & confidence filtering for cell phones, earbuds, books, and unauthorized screens. |
| **Object Detection Worker** | `lib/ai-interview/object-detection.worker.ts` | Web Worker running TensorFlow.js COCO-SSD with WebGL/CPU fallback and non-blocking concurrency. |
| **Unit Tests** | `lib/ai-interview/extractor.test.ts` | Vitest test suite for keyword extraction and fallback parsing. |
| **Extract API Route** | `app/api/ai-interview/extract/route.ts` | POST endpoint for Resume & JD extraction. |
| **Questions API Route** | `app/api/ai-interview/generate-questions/route.ts` | POST endpoint for generating HR interview questions. |
| **Uploader Component** | `components/ai-interview/resume-jd-uploader.tsx` | Drag-and-drop file upload & text paste UI. |
| **Results Component** | `components/ai-interview/keyword-results.tsx` | Dashboard displaying match score, skill gaps, and synchronized question selection & duration. |
| **Page View** | `app/dashboard/ai-interview/extractor/page.tsx` | Next.js 15 App Router page view (`/dashboard/ai-interview/extractor`). |
| **Live Interview Entry** | `app/interview/[id]/page.tsx` | Proctoring room featuring face tracking, background voice, and real-time object detection. |


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
