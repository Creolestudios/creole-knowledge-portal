# Costing Matrix (`gemini-3.8-flash-lite`)

### 1. Unified Model Costing Matrix

| Module Name | All Tasks Handled | The Single Model | Total Usage & Cost |
| :--- | :--- | :--- | :--- |
| **AI Interview Module** | • Dynamic Question Bank Generation<br>• Candidate Competency & Rubric Scoring<br>• CEFR English Fluency Assessment<br>• Dynamic Executive Verdict & Headline | `gemini-3.8-flash-lite` | **Per 1 Candidate Interview:**<br>• **8 to 12 API Calls**<br>• **~20,000 Text Tokens** *(~16,000 Input / ~4,000 Output)*<br>• **~12 Minutes Audio**<br>**Est. Cost: ~$0.0025 – $0.015**<br>*(~₹0.20 – ₹1.25 INR)* |
| **Blog Fetch & Synthesis Module** | • Scraped Article Re-ranking<br>• Daily Digest Synthesis & Key Takeaways<br>• Executive Briefing Generation<br>• Daily Knowledge Quiz Generation<br><br>*(Vector Math handled separately by Embeddings)* | `gemini-3.8-flash-lite`<br><br>+ **Separate:**<br>`text-embedding-004` | **Per 1 User Daily Cycle:**<br><br>**1. Generative Text LLM (`gemini-3.8-flash-lite`):**<br>• **2 to 3 API Calls** *(1 Rerank + 1 to 2 Synthesis)*<br>• **~10,000 Text Tokens** *(~7,000 Input / ~3,000 Output)*<br>• **LLM Cost: ~$0.0014** *(~0.14 cents)*<br><br>**2. Vector Embeddings (`text-embedding-004`):**<br>• **7 to 11 API Calls** *(1 query + ~5–9 articles + 1 digest)*<br>• **~7,000 Embedding Tokens**<br>• **Embedding Cost: $0.00** *(Separate Free Tier: 1,500 RPM)*<br><br>**Combined Est. Cost: ~$0.0014 – $0.002**<br>*(~₹0.12 – ₹0.16 INR)* |

---

### 2. Official Google Gemini Pricing Rates

| Model Name | API Function | Input Price (per 1M tokens) | Output Price (per 1M tokens) | Free Tier Allowance |
| :--- | :--- | :--- | :--- | :--- |
| **`gemini-3.8-flash-lite`** | `GenerateContent` | **$0.075** | **$0.300** | 15 RPM / 1,500 RPD |
| **`text-embedding-004`** | `EmbedContent` | **$0.020** *(Billable)* | **N/A** | **1,500 RPM (Effectively Free)** |

---

### 3. Model Cost Comparison

| Metric | `gemini-3.1-pro-preview` | `gemini-3.8-flash-lite` | Difference |
| :--- | :--- | :--- | :--- |
| **Input Price (per 1M tokens)** | $1.25 | **$0.075** | **94% Cheaper** |
| **Output Price (per 1M tokens)** | $5.00 | **$0.300** | **94% Cheaper** |
| **Cost per 1 Candidate Interview** | ~$0.22 – $0.24 | **~$0.0025 – $0.015** | **~20x Cheaper** |
| **Cost per 1 Daily Blog Cycle** | ~$0.035 – $0.045 | **~$0.0014 – $0.002** | **~20x Cheaper** |
| **Embedding Cost** | Grouped in LLM tokens | **$0.00** *(Separate 1,500 RPM free pool)* | **Isolated / Zero Extra Cost** |
