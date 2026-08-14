# ⚠️ Action Required: `main` History Was Rewritten — Re-sync Instructions

## What happened

`main` contained real, live secrets committed in plaintext in these files:

- `.claude/mcp.json` — Notion API token
- `.mcp.json` — a different Notion API token
- `.gemini/agents/portal-task-agent.md` — duplicate of the token above
- `fetch-blogs/.env.example` — a real Gemini/GCP API key

To fully remove them (not just stop new commits from adding them, but purge them from every past commit), `main`'s git history was rewritten and force-pushed. **Every commit hash on `main` has changed.**

## What you need to do — before you touch `main` again

**Do NOT run `git pull` on `main`.** Since the history changed underneath you, a plain pull will try to merge two histories git considers unrelated and will either fail or create a tangled mess of conflicts and duplicate commits.

Instead, run:

```bash
git fetch origin
git checkout main
git reset --hard origin/main
```

This discards your local `main` and snaps it to match the rewritten one exactly.

> If you're not comfortable with git or just want the simplest path: delete your local clone entirely and `git clone` the repo fresh. Heavier (redownloads everything, loses any uncommitted local work), but zero git commands to think about.

**Only do this on `main` itself.** If you have local changes sitting directly on `main` that aren't pushed anywhere, back them up first (`git branch backup-my-work` before resetting) — `reset --hard` discards uncommitted and unpushed work with no way to recover it afterward.

## What about my feature branch?

If your branch was created *before* this rewrite, it still contains the old secrets in its own history — resetting `main` doesn't touch that. For now, existing feature branches are being phased out rather than individually rebased. If you need to keep working on one:

- Create a fresh branch off the new `main` and re-apply/cherry-pick your changes onto it, **or**
- Ask for help rebasing your branch onto the new `main` (`git rebase --onto main <old-main-commit> <your-branch>`), which will require resolving any conflicts by hand.

Either way, don't merge an old branch into the new `main` without doing one of the above first — it would reintroduce the same secrets into history.

## Credential rotation

The Notion tokens and the Gemini/GCP key found in these commits should be treated as compromised regardless of the history rewrite — anyone who saw them before this point still has working copies. If they haven't already been rotated, that should happen independently of any git step above.

## Questions

If `git reset --hard origin/main` reports anything unexpected, or you're unsure whether you have local work at risk, stop and ask before running it — it's not reversible once run.
