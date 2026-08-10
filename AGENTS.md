# Agent Instructions for tamago

## Critical Rules

- Be extremely concise; sacrifice grammar for concision.
- Use built-in tools for file operations.
- Use globs for file search, grep for content search, read for viewing files.
- Do not request grep/sed/fd/find/ls/cat or similar CLI tools when you
  already have these capabilities built-in.
- Read code before modifying it.  Understand existing patterns and
  context before proposing changes.
- Always list unresolved questions at end.
- Keep documention (.md files) up to date with code changes.


## Revision Control

- Do not add Claude attribution to commit messages.
- Do not commit without permission.
- PRs should generally be comprised of one functional change; suggest
  making a commit before moving onto something unrelated.
- All tests must pass before committing.
- Never use -a to commit; always enumerate the files.


## Programming Rules

- Prefer ASCII in all code and user-facing strings (logs, CLI output,
  error messages).  Ask before using Unicode.
- Prefer consistency above most other concerns.
- Do not add trivial, obvious or redundant comments.
- Be DRY.
- Avoid magic constants.
- Only comment unintiutive or hard to understand code.
- Always comment data structures.
- Don't abbreviate by dropping letters from the middle of a word.
  Truncation (cutting from the end) is OK.


## TypeScript Rules

- All code lives in `web/`; run npm commands from there.
- Use `npm` (the committed `package-lock.json`) for dependency management.
- Run `npm run lint` (Biome) after changes and before commits.
- Run tests with `npm test` (Vitest).
- Rebuild (`npm run build`) and commit `prebuilts/app/` when changing the app;
  CI fails if the committed bundle does not match `web/src`.
- The engine (`web/src/engine/`) is framework-free: no React imports.
- Do not edit `web/goldens/`; it is frozen reference output.
