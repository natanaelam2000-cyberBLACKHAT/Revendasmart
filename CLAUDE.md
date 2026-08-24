# RevendaSmart — Claude Code Rules

## Scope
- Solve only the requested problem; do not expand scope or refactor nearby code.
- No broad audits unless asked. Investigate the specific failure first.
- Reuse existing helpers/components before creating abstractions. Avoid new dependencies.
- Never commit, push, deploy, publish Firestore/Storage Rules, touch production, Cloud Run,
  indexes, migrations, APK/AAB, or Vercel env — unless explicitly authorized in the request.
- The worktree is intentionally dirty. Never reset, restore, clean, stash, rebase or discard
  unrelated changes.

## Context
- Read only files needed now; don't re-read unchanged ones.
- Search by exact symbol/path before broad repo search.
- Quote only the relevant lines; never dump whole files into the conversation.
- Review changes with `git diff`, not by re-reading full files.
- Resuming work: check `git status`/`git diff` first, then continue from there.
- Reuse architecture learned earlier in the session unless those files changed.
- Don't repeat validation that already passed unless the code behind it changed.

## Output
- Concise: what was done, result, failures, next required step.
- Don't restate the request or narrate routine tool calls.
- Keep working through implementation; report intermediate steps only when blocked.
- Report failures with the actual error before switching strategy.

## Project specifics
- Gates: `npm run check` · `npm test` · `npm run build` · `npm run performance:bundle-check`
  (JS budget 2265 kB — never change it) · lint touched files with `--max-warnings=0`.
- Firebase emulator: `npm run test:firebase` fails on Windows cmd (the `npm_config_cache=` prefix
  is bash syntax). Run it through the Bash tool, and free port 8080 if a previous run is stuck.
- `script/smoke-tests.ts` asserts source text. When a correct change breaks an assertion, update
  the assertion to match the new implementation — do not weaken the guarantee it protects.
- Run focused checks during work; full gates before declaring an implementation complete.

## Always allowed when asked
Running code, deep analysis, full audits, complete test suites, long explanations.
Explicit user instructions always override the defaults above.
