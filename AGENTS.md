# Codex Working Guide

## Before Editing
- Treat `app/index.html` as the canonical app entrypoint.
- Keep `index atual.html` only as a compatibility/historical copy unless the user asks otherwise.
- Do not commit full private server logs. Use sanitized excerpts in `tests/fixtures`.

## Validation Rules
- Run `npm run validate` before proposing a commit.
- Any simulator-model change must be checked against EK, RP, and Mazzerin RP fixtures.
- XP/h remains the primary validation metric; histograms and temporal charts are diagnostic.
- If a change improves a curve but worsens XP/h, call that out explicitly.

## Commit Rules
- Commit only after showing the user the summary of changed files.
- Use short messages like `Add validator temporal diagnostics` or `Fix RP grenade timing`.
- Push only when the user explicitly asks for push.

## GitHub
- This project expects GitHub CLI (`gh`) for authentication.
- If `npm run git:ready` fails, fix the listed setup items before committing/pushing.
