# Claude — Claude Widget

Read `AGENTS.md` in this folder for full project context, stack, file map, and IPC schema.

## Behavior

- Prefix all AI-generated files with `(C)`.
- Ask before editing any file **without** the `(C)` prefix.
- CommonJS throughout — no ESM, no bundler, no TypeScript.
- Annotate OS-specific code: `// Windows only` or `// macOS only`.
- After each dev session, drop a log entry in the vault under `playground/Claude Widget/02 Iteration Logs/`.
- No feature creep mid-session — log new ideas in vault `00 Planning/`, finish current task first.
- When unsure about a pattern, check the reference repo ([SlavomirDurej/claude-usage-widget](https://github.com/SlavomirDurej/claude-usage-widget)) for conventions but **do not copy code** from it.
