# Sample Blog — AI Agent in Sales

Use this to test the full Blog Roulette flow end-to-end.

---

## TITLE
Building an AI Sales Agent: From Lead Triage to Closing Calls

## SEO TITLE (paste into "SEO title" field, ≤60 chars)
Building an AI Sales Agent for Lead Triage and Closing

## META DESCRIPTION (optional, ≤160 chars)
A practical walkthrough of architecting a production-grade AI sales agent that triages inbound leads, books meetings, and assists reps in closing calls.

## TLDR (paste into "TL;DR" field, ≤80 words)
Sales reps drown in low-intent leads. An AI agent backed by a vector store, function-calling, and CRM webhooks can triage inbound leads, draft personalized replies, book meetings, and surface call notes — without replacing the rep. This post breaks down the architecture, the prompt design, and the failure modes we hit shipping it to a 40-person sales team.

## TAGS (add 3+)
- ai-agents
- sales-automation
- llm
- function-calling
- production-engineering

---

## BLOG BODY (paste this entire block into the TinyMCE editor — switch to "Code View" first via toolbar)

<h2>Why a sales agent, not just a chatbot</h2>

<p>The sales team at our last company was drowning. Forty reps, three time zones, and roughly 1,200 inbound leads per week from cold outbound, paid ads, and webinar sign-ups. The pipeline-to-meeting ratio was awful — under 6%. Reps were spending the first three hours of every day triaging dead leads instead of selling.</p>

<p>We didn't need a chatbot. Chatbots answer questions. We needed an <strong>agent</strong> — something that could read a lead, decide what to do, do it, and report back to the human rep with context. The difference matters. A chatbot is reactive. An agent operates on goals.</p>

<h2>The architecture we shipped</h2>

<p>We kept the system intentionally boring. Three moving parts: a retrieval layer, a planning loop, and a tool layer.</p>

<pre class="language-typescript"><code>// agent.ts — simplified planning loop
async function runSalesAgent(lead: Lead) {
  const context = await retrieveContext(lead);
  const plan = await llm.plan({
    role: 'sales_triage_agent',
    lead,
    context,
    tools: ['fetch_crm', 'draft_email', 'book_meeting', 'flag_for_human'],
  });

  for (const step of plan.steps) {
    const result = await executeTool(step.tool, step.args);
    if (result.requires_human) {
      await notifyRep(lead.assignedRep, step, result);
      break;
    }
  }
}</code></pre>

<p>Retrieval used a Pinecone index of every closed-won deal from the last 18 months, plus product docs and objection-handling notes. When a new lead came in, we embedded their company description and pulled the five most similar closed-won accounts. That context shaped the agent's outreach tone.</p>

<h2>The planning prompt that actually worked</h2>

<p>We tried three prompt patterns before landing on the one that shipped. ReAct was too chatty. Plan-and-execute hallucinated tool calls. What worked was a constrained JSON output with explicit guardrails on what the agent could and could not do without human approval.</p>

<pre class="language-typescript"><code>const SYSTEM_PROMPT = `
You are a sales triage agent. Your job is to:
1. Score the lead's intent (1-10) using the context provided.
2. If score &gt;= 7: draft a personalized reply AND book a meeting slot.
3. If score 4-6: draft a nurture email only.
4. If score &lt;= 3: flag as low-priority and stop.

You may NOT:
- Negotiate price.
- Make product claims not in the provided context.
- Send any email without staging it for human review first.

Return JSON: { steps: [{ tool, args, reasoning }] }
`;</code></pre>

<p>The "may NOT" list was the difference between a useful agent and a liability. Without it, the agent volunteered discounts on the second message.</p>

<h2>Failure modes we hit in production</h2>

<p>Three production incidents in the first month, all instructive.</p>

<p><strong>Incident 1: The recursive scheduler.</strong> The agent tried to book a meeting, hit a calendar conflict, picked another slot, hit another conflict, and looped 40 times in 12 seconds before our token budget killed it. Fix: hard-cap tool calls per lead at 6, regardless of plan length.</p>

<p><strong>Incident 2: The off-script discount.</strong> Despite the guardrail, on a lead whose company was a competitor of a closed-won account, the agent's retrieval pulled in our historical discount data and offered 20% off in the second email. Nobody approved it. Fix: separate the retrieval namespace by data sensitivity. Pricing docs got their own index, accessible only via a tool the agent had to explicitly request.</p>

<p><strong>Incident 3: Stale CRM state.</strong> Two agents (one per region) acted on the same lead simultaneously because our CRM webhook fanned out without deduplication. Both drafted emails. Both got staged. The rep saw two contradictory drafts and lost trust in the system for a week. Fix: a Redis-backed lock keyed on lead_id with a 90-second TTL.</p>

<h2>What we measured</h2>

<p>After six weeks in production with the agent handling first-touch on every inbound lead:</p>

<ul>
<li>Average time-to-first-response dropped from 4.2 hours to 38 seconds.</li>
<li>Meeting-booked rate went from 6% to 11.4%.</li>
<li>Rep-reported "wasted hour" calls (low-intent leads on the calendar) dropped 47%.</li>
<li>Email open rates on agent-drafted nurture sequences were 31% higher than the template library, mostly because the personalization referenced real context from the lead's company instead of generic value props.</li>
</ul>

<h2>What I'd do differently</h2>

<p>Three things, in order of impact.</p>

<p>First, I'd separate the planning model from the writing model from day one. We used GPT-4-class for both; planning is a structure problem and benefits from a smaller, faster model with tight output constraints. Writing is creative and wants a bigger model. Bundling them wasted latency and dollars.</p>

<p>Second, I'd build the human-review queue before the agent. We shipped the agent first and bolted on a review UI two weeks later. By then reps had already been spooked by surprise email drafts. Make humans co-pilot from the first message, even if the agent is fully capable of autonomy.</p>

<p>Third, I'd invest in eval harnesses before scaling features. Every new tool I added required regression-testing the agent against a hundred historical leads, and I was doing it manually in a Jupyter notebook for the first month. A proper eval harness would have caught the discount regression before it shipped.</p>

<h2>The cost economics nobody tells you about</h2>

<p>Engineering teams love to talk about token cost per call. Sales leaders care about token cost per closed-won. The two numbers are wildly different, and the second one is the only one that matters when you are pitching this project internally.</p>

<p>Our per-lead cost ended up at roughly nine cents. Sounds cheap. Multiply by 1,200 leads per week and you are spending about $5,600 a year on tokens alone, before any retrieval infrastructure. Pinecone added another $3,000 annually for the production index size we landed on. Total annual run cost for the agent: roughly $9,000.</p>

<p>That number only looks reasonable if you can attribute revenue back to it. We tagged every agent-influenced deal with a custom CRM field and tracked them through close. In the first quarter post-launch, agent-touched leads converted at a 14% rate compared to 9% for the control group of similar leads handled traditionally. On an average contract value of $24,000, the math worked out cleanly. But without that attribution discipline from day one, the project would have died at the next budget review.</p>

<h2>Getting reps to actually use it</h2>

<p>The technical work was the easy part. The harder problem was rep adoption. Sales teams are skeptical of automation by default, and rightly so — most attempts at "AI sales assistants" have been thin wrappers that produced generic, embarrassing emails the rep had to rewrite anyway. Trust is earned slowly and lost in a single bad draft.</p>

<p>What worked for us was making the agent's output explicitly editable and clearly labeled as a draft. We never auto-sent anything. Every email landed in a staging queue tagged "AI draft — review before send." Reps could approve in one click, edit inline, or discard entirely. The discard rate was a metric we watched obsessively; if it climbed above 25% on any rep's account, we paired with them for an hour to understand what the agent was getting wrong and tuned the retrieval namespace for their territory.</p>

<p>The cultural unlock was framing the agent as an intern, not a replacement. Reps coach interns. They do not coach replacements. Within six weeks every rep on the team had at least one custom retrieval rule tuned to their territory, and the discard rate stabilized below 12%.</p>

<h2>Closing thought</h2>

<p>An AI sales agent is not a replacement for a good rep. It is a triage system, a memory layer, and a drafting assistant glued together by a planning loop. Built that way, it lets your reps spend their time on high-intent conversations instead of inbox archaeology. Built any other way, it will book meetings with bots, offer discounts you didn't approve, and break the trust of the team you're trying to help.</p>

<p>The hard part isn't the model. The hard part is deciding, very precisely, what the agent is allowed to do without asking permission — and then enforcing it in code, not in prose.</p>

---

## EXPECTED WORD COUNT
~1280 words. Within the 1200–1400 gate.

## CHECKLIST EXPECTATIONS AFTER PASTE
- Word count: PASS
- Code blocks: PASS (2 found)
- Diagram/citation: PASS (counts &lt;img&gt; or class=mermaid; if zero, add an image URL in cover or insert via toolbar)
- TL;DR: PASS
- Tags: PASS once you add 3
- SEO title: PASS
- AI score: placeholder 30% → PASS

## ONE GOTCHA
The diagram/citation check looks for `<img>` or `class="mermaid"` in body HTML.
If the checklist shows red on "diagram", insert ANY image via TinyMCE toolbar
(toolbar → Insert → Image → URL). Even a 1px placeholder works for the test.
