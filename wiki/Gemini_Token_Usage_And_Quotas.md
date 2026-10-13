# Gemini AI Usage, Token Lifecycle & Cost Analysis

This document provides a refined, standalone technical audit of **Google Gemini API** usage for the **AI Interview Module** and the **Blog Fetch & Synthesis Module**, reflecting the replacement of the conversational Copilot with the **On-Demand Admin Re-Evaluation** feature (flagged as *Yet to be implemented*).

---

## 1. Unified Model Matrix (`gemini-3.1-pro-preview`)

| Module Name | All Tasks Handled | The Single Model | Total Usage & Cost |
| :--- | :--- | :--- | :--- |
| **AI Interview Module** | • Spoken Audio Transcription<br>• Dynamic Question Bank Generation<br>• Candidate Competency & Rubric Scoring<br>• CEFR English Fluency Assessment<br>• Dynamic Executive Verdict<br>• **Admin Custom Re-Evaluation** *(Yet to be implemented)* | `gemini-3.1-pro-preview` | **Per 1 Candidate Interview**<br>• **12 API Calls** *(13 if Re-Evaluated)*<br>• **~20,000 Text Tokens**<br>• **~12 Minutes Audio**<br>**Est. Cost: ~$0.22 – $0.24** |
| **Blog Fetch & Synthesis Module** | • Scraped Article Re-ranking<br>• Daily Digest Synthesis & Takeaways<br>• Executive Briefing Generation<br>• Daily Knowledge Quiz Generation<br>*(Vector Math: `text-embedding-004`)* | `gemini-3.1-pro-preview`<br>+ `text-embedding-004` | **Per 1 User Daily Cycle**<br>• **13 API Calls**<br>• **~17,300 Tokens**<br>**Est. Cost: ~$0.035 – $0.045** |

---

## 2. Token & Cost Distribution Chart

### Per Candidate Interview Cost Breakdown ($0.23 Total)
```mermaid
pie title AI Interview Cost Distribution with Re-Evaluation ($0.23 Total)
    "Audio Transcription (12 mins)": 0.180
    "Admin Re-Evaluation [5 Inputs] (Yet to be implemented)": 0.015
    "Initial Competency Scoring & Rubrics": 0.013
    "Question Generation": 0.009
    "CEFR Fluency & Verdict": 0.007
```

### Per User Blog Fetch Daily Cycle Cost Breakdown ($0.035 Total)
```mermaid
pie title Blog Fetch Cost Distribution ($0.035 Total)
    "Daily Digest Synthesis": 0.0125
    "Article Re-ranking": 0.0060
    "5-Question Daily Quiz": 0.0075
    "text-embedding-004 Embeddings": 0.0003
```

---

## 3. End-to-End Cycle: AI Interview Module (Per 1 Candidate)

> **Admin Custom Re-Evaluation (Yet to be implemented)**: Re-assesses candidate text transcripts in 1 single API call against up to 5 custom criteria provided by the admin, generating an updated scorecard and targeted verdict.

```mermaid
graph TD
    A["1. Upload JD + Resume"] -->|1 Call • 4.2k Tokens| B["Dynamic Question Bank Generation"]
    B --> C["2. Candidate Video Interview (8 Questions)"]
    C -->|8 Calls • ~12 mins Audio| D["Spoken Answer Transcription"]
    D -->|1 Call • 6.0k Tokens| E["Competency Scoring & Quote Grounding"]
    E -->|1 Call • 3.5k Tokens| F["CEFR Fluency & Dynamic Executive Verdict"]
    F --> G["Final Stored in Supabase (interview_reports)"]
    G -.->|Optional 1 Call • 7.0k Tokens| H["Admin Custom Re-Evaluation [Up to 5 Inputs] (Yet to be implemented)"]
```

### Step-by-Step Call & Token Audit:

| Step | Action | Input Units | Output Units | Est. Cost (`gemini-3.1-pro-preview`) |
| :---: | :--- | :--- | :--- | :---: |
| **1** | **Question Generation** (1 call) | 3,000 tokens (JD + Resume) | 1,200 tokens (8 structured questions) | **$0.009** |
| **2** | **Audio Transcription** (8 calls) | ~12 mins audio (candidate answers) | 2,000 text tokens (transcripts) | **$0.180** |
| **3** | **Competency Scoring** (1 call) | 4,500 tokens (answers + rubrics) | 1,500 tokens (scores + quotes) | **$0.013** |
| **4** | **CEFR Fluency & Verdict** (1 call) | 2,800 tokens (transcripts + grammar) | 700 tokens (headline + summary) | **$0.007** |
| **5** | **Admin Custom Re-Evaluation** (1 call)<br>*(Yet to be implemented — up to 5 inputs)* | 5,200 tokens (transcripts + 5 criteria) | 1,800 tokens (new scores & summary) | **$0.015** |
| **Total** | **Full Candidate Lifecycle (with Re-Evaluation)** | **~15,500 In + 12m Audio** | **~7,200 Out Tokens** | **~$0.224** |

*(Note: If the admin does not trigger a re-evaluation, the total interview cost is **~$0.209**).*

---

## 4. End-to-End Cycle: Blog Fetch Module (Per 1 User Daily Cycle)

```mermaid
graph TD
    A["Raw Crawled Tech Blogs (15 Posts)"] -->|10 Calls • 4k Tokens| B["text-embedding-004 Vector Embeddings"]
    B -->|Cosine Match against User Vector| C["Top 15 Candidate Pool"]
    C -->|1 Call • 3.8k Tokens| D["Gemini LLM Re-ranking"]
    D -->|1 Call • 6.2k Tokens| E["Daily Digest Synthesis (Top 3 Posts)"]
    E --> F["Saved in MongoDB (daily_digests)"]
    F -->|1 Call • 3.3k Tokens| G["On-Demand 5-Question Daily Quiz"]
    G --> H["Rendered on User Dashboard"]
```

### Step-by-Step Call & Token Audit:

| Step | Action | Input Units | Output Units | Est. Cost |
| :---: | :--- | :--- | :--- | :---: |
| **1** | **Vector Embeddings** (10 calls) | 4,000 tokens (`text-embedding-004`) | 768-dim vectors | **$0.0003** |
| **2** | **Article Re-ranking** (1 call) | 3,500 tokens (15 summaries) | 300 tokens (JSON ranked IDs) | **$0.0060** |
| **3** | **Digest Synthesis** (1 call) | 5,000 tokens (top 3 full articles) | 1,200 tokens (takeaways & synthesis) | **$0.0125** |
| **4** | **Daily Knowledge Quiz** (1 call) | 2,500 tokens (digest context) | 800 tokens (5 vetted questions) | **$0.0075** |
| **Total** | **1 User Daily Digest Cycle** | **~15,000 Input Tokens** | **~2,300 Output Tokens** | **~$0.0263** |

---

## 5. Google Gemini Pricing Rates Reference

| Model | Input Text (per 1M Tokens) | Output Text (per 1M Tokens) | Audio Input (per Minute) |
| :--- | :--- | :--- | :--- |
| **`gemini-3.1-pro-preview`** | **$1.25** | **$5.00** | **$0.015** |
| **`text-embedding-004`** | **$0.08** | N/A | N/A |
| *(Comparison: `gemini-3.6-flash`)* | *$0.15* | *$0.60* | *$0.0035* |
