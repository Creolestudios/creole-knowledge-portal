# AI Quiz Evaluation & Grading Strategies

This document outlines the current logic, edge cases, and future implementation strategies for how user answers are evaluated and graded within the Creole Knowledge Portal quiz module.

## 1. Multiple-Choice & Multi-Select Evaluation
**Current Implementation:** Strict Array Matching
- **File:** `app/api/quizzes/evaluate/route.ts`
- **Logic:** The system normalizes and sorts both the `correct_answers` array and the `userAnswer` array. It strictly compares the length and values.
- **Edge Cases Handled:**
  - *User selects all options (guessing):* If a question has 4 options and 2 are correct, selecting all 4 results in a length mismatch (4 vs 2). The system correctly marks this as **Incorrect (0 points)**.
  - *User selects partial correct options:* If 3 are correct and the user selects 2, it is marked as **Incorrect (0 points)**.

**Future Considerations (Partial Scoring):**
If a more forgiving scoring system is required in the future, the logic can be updated to:
- Award +1 point per correct option selected.
- Subtract -1 point per incorrect option selected (to penalize "select all" guessing).

---

## 2. Text / Descriptive Questions Evaluation
**Current Implementation:** Semantic AI Evaluation
- **File:** `lib/ai/quiz-evaluator.ts`
- **Logic:** Hardcoded string matching cannot reliably grade human text, so the system delegates this to a LLM (Gemini) acting as a grading teacher.
- **Edge Cases Handled:**
  - *Rephrased Answers:* If the user answers using their own words or another AI, the evaluator prompt checks for the **"core concept"** rather than exact vocabulary matches. If the technical meaning is identical, it is marked **Correct**.
  - *Grammar / Typographical Errors:* The AI is instructed to ignore syntax errors or poor grammar, focusing purely on technical accuracy.
  - *Empty Fluff:* If a user writes a 300-word essay that sounds plausible but misses the core technical concept, the AI is instructed to fail it.

### The Evaluator Prompt Strategy
The semantic AI evaluation works because the prompt structure explicitly defines boundaries:
1. It provides the original question.
2. It provides the answer key (core concept).
3. It provides the user's raw text.
4. It strictly commands the AI to determine if the user's text logically satisfies the core concept, returning a structured JSON response (`isCorrect`, `points`, `reason`).

---

## 3. Code Snippet Evaluation
**Logic:** Similar to Descriptive Evaluation, the AI evaluates the *logic* of the code rather than the exact syntax. 
- *Example:* If the answer key uses a `while` loop but the user implements a mathematically identical `for` loop, the AI evaluator comprehends the logic and awards full points.

## Maintenance Notes
- If the AI evaluator becomes too strict or too lenient, adjust the system instructions in `lib/ai/quiz-evaluator.ts` to tune the strictness threshold.
- To prevent rate limits during evaluations, ensure exponential backoff or fallback mechanisms are in place if the evaluation API fails to respond.
