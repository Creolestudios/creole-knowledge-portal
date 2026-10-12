# Gemini API & Model Usage Guide

This document tracks where the Gemini API (`GEMINI_API_KEY`) is utilized across the Creole Knowledge Portal's various modules. It explicitly outlines the **Best Recommended Model** for each section now that a Gemini Pro account is available.

> **Global Recommendation for Pro Users:** Set `GEMINI_MODEL=gemini-3.1-pro-preview` (or `gemini-1.5-pro`) in your `.env` files. The system's fallback queues will automatically prioritize the Pro model for all complex reasoning tasks while still safely falling back if needed.

---

## 1. AI Interview Module (`app/api/ai-interview/`, `lib/ai-interview/`)

### A. Question Generation (`lib/ai-interview/question-generator.ts`)
* **What it does:** Analyzes the candidate's profile and job description to formulate 4-5 tailored interview questions.
* **Current Fallback:** `process.env.GEMINI_MODEL` -> `gemini-3.5-flash-lite` -> `gemini-3.6-flash`.
* **Best Model to Use:** **`gemini-3.1-pro-preview`** (or `gemini-1.5-pro`). Generating high-quality, personalized questions without repetition requires deep reasoning and a large context window. Pro models excel at this and will not ask generic questions.

### B. Audio Transcription (`lib/ai-interview/transcribe.ts`)
* **What it does:** Converts the candidate's spoken audio answers into raw text.
* **Current Fallback:** Hardcoded to `gemini-3.6-flash`.
* **Best Model to Use:** **`gemini-3.6-flash`** (or `gemini-1.5-flash`). Even with a Pro account, Flash is the absolute best model for pure audio-to-text transcription. It processes multi-modal audio significantly faster than Pro, which is critical to avoid hanging the candidate's browser while they wait.

### C. Content Extraction (`lib/ai-interview/extractor.ts`)
* **What it does:** Processes the raw transcript to extract structured candidate insights and filters out noise.
* **Current Fallback:** `process.env.GEMINI_MODEL` -> Flash models.
* **Best Model to Use:** **`gemini-3.1-pro-preview`** (or `gemini-1.5-pro`). Extracting highly structured, exact JSON from messy, spoken-word transcripts requires strict instruction-following. Pro prevents dropped keys or hallucinated JSON structures.

### D. Performance Scoring (`lib/ai-interview/scorer.ts`)
* **What it does:** Evaluates the extracted answers against a strict grading rubric (grammar, coherence, CEFR band).
* **Current Fallback:** `process.env.GEMINI_MODEL` -> Flash models.
* **Best Model to Use:** **`gemini-3.1-pro-preview`** (or `gemini-1.5-pro`). Acting as a fair and accurate grader requires complex logical comparison between a rubric and an answer. The Pro tier provides a much more nuanced evaluation.

---

## 2. Blog Fetch Module (Python Backend - `fetch-blogs/`)

### A. Vector Embeddings (`src/ai_pipeline/embeddings.py`)
* **What it does:** Converts article text and user profiles into mathematical vectors to calculate semantic similarity.
* **Best Model to Use:** **`text-embedding-004`**. This is Google's dedicated, state-of-the-art embedding model. You should explicitly use this for highest precision over older embedding models.

### B. LLM Re-ranking (`src/ai_pipeline/reranker.py`)
* **What it does:** Explicitly re-ranks the top 10 articles based on the user's specific tech stack and preferences.
* **Current Fallback:** `GEMINI_MODEL` from config.
* **Best Model to Use:** **`gemini-3.1-pro-preview`** (or `gemini-1.5-pro`). Evaluating the subtle differences between 10 different articles and a complex user profile requires the heavy logical lifting that Pro provides.

### C. Digest Synthesis (`src/synthesis/generator.py`)
* **What it does:** Writes the final daily newsletter/briefing in JSON format.
* **Current Fallback:** `gemini-3.6-flash` -> `gemini-2.5-flash`
* **Best Model to Use:** **`gemini-3.1-pro-preview`** (or `gemini-1.5-pro`). For writing and summarizing a compelling newsletter that users actually want to read, Pro yields vastly superior prose and vocabulary.

---

## 3. Blog Write / Synthesis Module (`lib/synthesis/blog-compiler.ts`)

### A. Extracting & Cleaning (`extractCleanArticle`)
* **What it does:** Cleans noisy HTML/text into clean article metadata.
* **Current Fallback:** `gemini-2.5-flash`
* **Best Model to Use:** **`gemini-3.1-pro-preview`** (or `gemini-1.5-pro`). While Flash works fine here, Pro is better at understanding complex, messy webpage layouts to extract the truest representation of the article's core body text without accidentally including sidebars.

### B. Re-ranking Candidates (`rerankArticles`)
* **What it does:** Picks the best article from a list to base a new blog on.
* **Current Fallback:** `gemini-2.5-flash`
* **Best Model to Use:** **`gemini-3.1-pro-preview`** (or `gemini-1.5-pro`). Pro's reasoning capabilities will pick the most authoritative and comprehensive source material from the provided list.

### C. Writing the Blog (`generateDescriptiveBlog`)
* **What it does:** Generates the final, comprehensive Markdown blog post.
* **Current Fallback:** `gemini-2.5-flash`
* **Best Model to Use:** **`gemini-3.1-pro-preview`** (or `gemini-1.5-pro`). Writing engaging, long-form content is the absolute biggest strength of the Pro tier. The difference in readability and depth will be huge.

### D. Semantic Chunking (`chunkBlogSemantically`)
* **What it does:** Breaks the generated blog into a JSON array of sections.
* **Current Fallback:** `gemini-2.5-flash`
* **Best Model to Use:** **`gemini-3.6-flash`** (or `gemini-1.5-flash`). Since the text is already written beautifully by Pro, breaking it into JSON chunks is a structural, fast task. Flash handles this perfectly and saves you time.

---

## Expert Architecture: Hybrid Model Routing & Cost Estimations

*Assumptions (Pro Model pricing: ~$1.25/1M in, ~$5.00/1M out. Flash Audio: ~$0.002/min).*
* **AI Interview:** ~12 API calls per interview (10k text tokens, 15m audio).
* **Blog Fetch:** ~2 API calls per fetched blog (2k text tokens).
* **Blog Write:** ~4 API calls per written blog (17k text tokens).

| Module Name | Task Routing (Per Feature) | Best All-In-One Model | Expected Usage & Cost |
| :--- | :--- | :--- | :--- |
| **AI Interview** | • **Audio Transcription:** `gemini-3.6-flash`<br/>• **Question Gen:** `gemini-3.1-pro-preview`<br/>• **Extraction:** `gemini-3.1-pro-preview`<br/>• **Scoring:** `gemini-3.1-pro-preview` | **`gemini-3.1-pro-preview`** <br/> *(Pro is the only model with the deep reasoning required for grading, and it can also transcribe audio).* | **Per 1 Interview** <br/> ~12 API Calls <br/> ~10k tokens + 15m audio <br/> **Est: ~$0.07** |
| **Blog Fetch** | • **Vector Embeddings:** `text-embedding-004`<br/>• **Re-ranking:** `gemini-3.1-pro-preview`<br/>• **Digest Synthesis:** `gemini-3.1-pro-preview` | **`gemini-3.1-pro-preview`** <br/> *(Note: Vector Embeddings still strictly require `text-embedding-004`).* | **Max 25 Blogs/Day** <br/> ~50 API Calls <br/> ~62.5k tokens <br/> **Est: ~$0.13** |
| **Blog Write** | • **Extracting & Cleaning:** `gemini-3.6-flash`<br/>• **Re-ranking Candidates:** `gemini-3.1-pro-preview`<br/>• **Writing Blog:** `gemini-3.1-pro-preview`<br/>• **Semantic Chunking:** `gemini-3.6-flash` | **`gemini-3.1-pro-preview`** <br/> *(Capable of writing high quality prose, parsing JSON, and complex layout extraction all on its own).* | **Max 3 Blogs/Day** <br/> ~12 API Calls <br/> ~70.5k tokens <br/> **Est: ~$0.15** |
