# Zoho Task Evaluation Heuristics — Comprehensive Test Case Matrix

This document provides a complete, exhaustive specification of all test cases, input permutations, scoring formulas, and expected outputs for the **Zoho Task & Evaluation Engine** in the Creole Knowledge Portal.

---

## 1. Scoring Formula & Parameter Weights

Each evaluated task receives a composite score strictly out of **10.0** calculated from four weighted dimensions plus a QA status modifier:

$$\text{Final Score} = \min\Big(10.0, \; (\text{Comment Score} \times 0.45) + (\text{Time Score} \times 0.35) + (\text{Complexity Score} \times 0.10) + (\text{Repetition Score} \times 0.10) + \text{QA Bonus}\Big)$$

| Dimension | Weight | Score Range | Evaluation Focus |
| :--- | :---: | :---: | :--- |
| **Work & Comment Match** | **45%** (4.5 pts) | 0.0 – 10.0 | Do logged comments substantiate and prove the technical implementation described in the task? |
| **Time Adherence** | **35%** (3.5 pts) | 0.0 – 10.0 | Adherence to estimated hours within strict +5m overtime and -15m early buffer rules. |
| **Task Complexity** | **10%** (1.0 pt) | 1.0 – 10.0 | Technical depth, API endpoints, database schemas, and architectural scope. |
| **Originality (Non-Repetition)**| **10%** (1.0 pt) | 2.0 – 10.0 | Tokenized Jaccard similarity against historical tasks in the same project (<60% unique). |
| **QA Review Bonus** | **Modifier** | +0.3 – +0.5 pts | Awarded when task is actively verified and moved to `In QA Review`. |

---

## 2. Core Rule Definitions

### 2.1 Time Adherence Rules
- **Planned Minutes ($P$)** vs **Actual Minutes ($A$)**, Variance $\Delta = A - P$.
- **On Time ($\Delta = 0$ or $-15\text{m} \le \Delta < 0$)**: **10.0 / 10** (`ON_TIME`). Early finish within 15 minutes is fully tolerated.
- **Tolerated Overrun ($0 < \Delta \le +5\text{m}$)**: **10.0 / 10** (`SLIGHT_OVERRUN_TOLERATED`). Overtime up to 5 minutes is granted zero penalty.
- **Unexpected Early ($\Delta < -15\text{m}$)**:
  $$\text{Penalty} = \min\left(5.0, \; \frac{|\Delta| - 15}{P} \times 10 \times 0.8\right), \quad \text{Score} = \max(3.0, \; 10.0 - \text{Penalty}) \quad (\text{UNEXPECTED\_EARLY})$$
- **Overdue ($\Delta > +5\text{m}$)**:
  $$\text{Penalty} = \min\left(7.0, \; \frac{\Delta - 5}{P} \times 10 \times 0.7\right), \quad \text{Score} = \max(2.0, \; 10.0 - \text{Penalty}) \quad (\text{OVERDUE})$$
- **Not Logged ($A = 0$)**: **0.0 / 10** (`NOT_LOGGED`).

### 2.2 Work & Comment Match Rules
- **No Comments Logged**: **0.0 / 10** (`NO_COMMENTS`).
- **Superficial Comment** (e.g. `"done"`, `"fixed"`, `"resolved"`, `"ok"`): **4.0 / 10** (`WEAK_ALIGNMENT`).
- **Checklist Copy-Paste Comment** (mirrors description with `"- Done"` / `"Done"` and <15 novel technical words):
  - With brief description (<35 words): **4.8 / 10** (`WEAK_ALIGNMENT`).
  - With detailed description ($\ge 35$ words): **5.2 / 10** (`WEAK_ALIGNMENT`).
- **Brief Description (<35 words) AND Brief Comment (<35 words)**: **5.5 / 10** (`WEAK_ALIGNMENT`).
- **Brief Description OR Brief Comment**: **6.2 / 10** (`MODERATE_ALIGNMENT`).
- **Strong Technical Evidence** ($\ge 2$ technical action keywords + detailed context): **9.0 – 10.0 / 10** (`STRONG_ALIGNMENT`).
- **Active AI Subscriptions Boost**: **+0.2 pts** (applied when substantive context exists).

### 2.3 Repetition Detection Rules
- Tokenized Jaccard similarity against previous project tasks:
  $$\text{Similarity \%} = \frac{|T_{\text{current}} \cap T_{\text{history}}|}{|T_{\text{current}} \cup T_{\text{history}}|} \times 100$$
- If $\text{Similarity} \ge 60\%$: Flagged as `is_repetitive = true`. Repetition score drops from 10.0 down to **2.0 – 5.2 / 10**.

---

## 3. Exhaustive Test Case Matrix

| Test Case ID | Test Scenario | Planned Time | Actual Time | Description Quality | Comment Quality | Repetition | QA Review | Expected Time Score | Expected Comment Score | Expected Overall Score | Expected Time Label | Expected Alignment Label |
| :--- | :--- | :---: | :---: | :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **TC-01** | Perfect Delivery (Benchmark) | 4h 00m | 4h 00m | Detailed (>40 words) | Detailed (>40 words, action verbs) | No (10/10) | Yes (+0.3) | **10.0** | **9.6** | **9.9 / 10** | `ON_TIME` | `STRONG_ALIGNMENT` |
| **TC-02** | Tolerated +5m Overrun | 4h 00m | 4h 05m | Detailed | Detailed with PR & test notes | No (10/10) | Yes (+0.3) | **10.0** | **9.6** | **9.9 / 10** | `SLIGHT_OVERRUN_TOLERATED` | `STRONG_ALIGNMENT` |
| **TC-03** | Tolerated -15m Early Delivery | 4h 00m | 3h 45m | Detailed | Detailed with test verification | No (10/10) | Yes (+0.3) | **10.0** | **9.4** | **9.8 / 10** | `ON_TIME` | `STRONG_ALIGNMENT` |
| **TC-04** | Punctual Time + Zero Comments | 4h 00m | 4h 00m | Detailed (60 words) | **0 Comments Logged** | No (10/10) | Yes (+0.5) | **10.0** | **0.0** | **4.5 / 10** | `ON_TIME` | `NO_COMMENTS` |
| **TC-05** | Punctual Time + Vague Description + Vague Comment | 2h 00m | 2h 00m | Vague (<15 words) | Vague (<15 words, "worked on task") | No (10/10) | No (0.0) | **10.0** | **5.5** | **6.7 / 10** | `ON_TIME` | `WEAK_ALIGNMENT` |
| **TC-06** | Punctual Time + Detailed Description + Superficial Comment | 4h 00m | 4h 00m | Detailed (50 words) | Single word `"Done"` / `"Fixed"` | No (10/10) | No (0.0) | **10.0** | **4.0** | **6.1 / 10** | `ON_TIME` | `WEAK_ALIGNMENT` |
| **TC-07** | Punctual Time + Checklist Copy-Paste Comment | 4h 00m | 4h 00m | Detailed with bullets | Mirrored bullets with `"- Done"` | No (10/10) | No (0.0) | **10.0** | **5.2** | **6.6 / 10** | `ON_TIME` | `WEAK_ALIGNMENT` |
| **TC-08** | Detailed Comments + Moderate Overtime (+20m) | 4h 00m | 4h 25m | Detailed | Detailed with implementation notes | No (10/10) | Yes (+0.3) | **8.5** | **9.4** | **9.3 / 10** | `OVERDUE` | `STRONG_ALIGNMENT` |
| **TC-09** | Detailed Comments + Heavy Overtime (+1h 30m) | 4h 00m | 5h 35m | Detailed | Detailed with blockers explanation | No (10/10) | Yes (+0.3) | **5.3** | **9.2** | **8.1 / 10** | `OVERDUE` | `STRONG_ALIGNMENT` |
| **TC-10** | Detailed Comments + Extreme Overtime (Double Time) | 4h 00m | 8h 00m | Detailed | Detailed technical notes | No (10/10) | No (0.0) | **3.0** | **9.0** | **6.9 / 10** | `OVERDUE` | `STRONG_ALIGNMENT` |
| **TC-11** | Unexpected Early Finish (30m early) | 4h 00m | 3h 30m | Detailed | Brief completion comment | No (10/10) | Yes (+0.3) | **8.2** | **6.2** | **7.7 / 10** | `UNEXPECTED_EARLY` | `MODERATE_ALIGNMENT` |
| **TC-12** | Severe Early Finish (Finished in 1h of 4h planned) | 4h 00m | 1h 00m | Detailed | Brief comment | No (10/10) | No (0.0) | **4.5** | **6.2** | **5.7 / 10** | `UNEXPECTED_EARLY` | `MODERATE_ALIGNMENT` |
| **TC-13** | Zero Timelog Logged (Task closed without time) | 4h 00m | **0h 00m** | Detailed | Detailed comments logged | No (10/10) | No (0.0) | **0.0** | **9.0** | **4.9 / 10** | `NOT_LOGGED` | `STRONG_ALIGNMENT` |
| **TC-14** | Zero Timelog + Zero Comments | 4h 00m | **0h 00m** | Detailed | **0 Comments Logged** | No (10/10) | No (0.0) | **0.0** | **0.0** | **1.8 / 10** | `NOT_LOGGED` | `NO_COMMENTS` |
| **TC-15** | Empty Description + Detailed Comments | 3h 00m | 3h 00m | Empty string | Detailed progress notes | No (10/10) | Yes (+0.3) | **10.0** | **6.8** | **8.7 / 10** | `ON_TIME` | `MODERATE_ALIGNMENT` |
| **TC-16** | Empty Description + Empty Comments | 3h 00m | 3h 00m | Empty string | **0 Comments Logged** | No (10/10) | No (0.0) | **10.0** | **0.0** | **4.3 / 10** | `ON_TIME` | `NO_COMMENTS` |
| **TC-17** | Repetitive Task with High Overlap (>75% similarity) | 4h 00m | 4h 00m | Repeated copy | Repeated copy | **Yes (3.5/10)** | No (0.0) | **10.0** | **6.2** | **7.0 / 10** | `ON_TIME` | `MODERATE_ALIGNMENT` |
| **TC-18** | Repetitive Task + Overdue (+40m) + Vague Comment | 3h 00m | 3h 45m | Repeated copy | Brief `"Updated changes"` | **Yes (2.8/10)** | No (0.0) | **6.7** | **5.5** | **5.7 / 10** | `OVERDUE` | `WEAK_ALIGNMENT` |
| **TC-19** | QA Review Task with Acceptance Checklist Passed | 4h 00m | 4h 03m | Detailed QA Scope | Full regression checklist & test results | No (10/10) | **Yes (+0.5)** | **10.0** | **9.8** | **10.0 / 10** | `SLIGHT_OVERRUN_TOLERATED` | `STRONG_ALIGNMENT` |
| **TC-20** | Junior Dev (1 yr) with GitHub Copilot Used | 4h 00m | 4h 00m | Detailed | Technical comment with test files | No (10/10) | Yes (+0.3) | **10.0** | **9.6** | **9.9 / 10** | `ON_TIME` | `STRONG_ALIGNMENT` |
| **TC-21** | Senior Dev (5+ yrs) with Missing Architecture Context | 4h 00m | 4h 00m | Detailed | Brief comment without architecture note | No (10/10) | No (0.0) | **10.0** | **6.2** | **7.6 / 10** | `ON_TIME` | `MODERATE_ALIGNMENT` |
| **TC-22** | Duration Format: Clock string `"8:15"` | 8h 00m | 8h 15m (`495m`) | Detailed | Detailed technical commentary | No (10/10) | Yes (+0.3) | **8.5** | **9.4** | **9.3 / 10** | `OVERDUE` | `STRONG_ALIGNMENT` |
| **TC-23** | Duration Format: Decimal number `8.25` | 8h 00m | 8.25 (`495m`) | Detailed | Detailed technical commentary | No (10/10) | Yes (+0.3) | **8.5** | **9.4** | **9.3 / 10** | `OVERDUE` | `STRONG_ALIGNMENT` |
| **TC-24** | Indian/UK Timestamp Comment Ingestion (`30-10-2026 07:10 PM`)| 4h 00m | 4h 00m | Detailed | Parsed valid comment with Indian timestamp | No (10/10) | Yes (+0.3) | **10.0** | **9.4** | **9.8 / 10** | `ON_TIME` | `STRONG_ALIGNMENT` |
| **TC-25** | Worst Case Combination | 4h 00m | **0h 00m** | Vague (<10 words) | **0 Comments Logged** | **Yes (2.0/10)** | No (0.0) | **0.0** | **0.0** | **1.0 / 10** | `NOT_LOGGED` | `NO_COMMENTS` |

---

## 4. Key Takeaways for Developers & Evaluators

1. **Comments are 45% of the score**: Even if a developer completes a task with 100% time accuracy, logging **0 comments** drops the overall score from **9.8+ down to ~4.5/10**.
2. **5-Minute Overrun Grace Buffer**: Tasks that run 1 to 5 minutes overtime receive **zero penalty** (10/10 Time Adherence).
3. **15-Minute Early Gap Allowance**: Finishing up to 15 minutes early receives **zero penalty**. Finishing more than 15 minutes early flags potential over-estimation.
4. **Substance Over Checklists**: Copying the description with `- Done` yields only **4.8 – 5.2/10** on comment quality. Explaining actual implementation steps and attaching commit/test links yields **9.0 – 10.0/10**.
5. **Exact Timelog Integrity**: Logged hours format seamlessly whether entered as `"08:15"`, `"8:15"`, or decimal `8.25` (all evaluate to 495 minutes / 8:15 hrs).

