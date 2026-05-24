# PolySmith — Copilot/Codex Instructions

## Documentation

All project documentation lives in `wiki/polysmith.wiki/`. The `docs/`
directory is deprecated and must not be read or written to.

### First-session reading order

Read these pages to understand the system before making changes:

1. **`wiki/polysmith.wiki/Architecture-Overview.md`** — system layout: React UI, Tauri shell, C++ CAD core, IPC bridge
2. **`wiki/polysmith.wiki/Contextual-Modeling-Workflow.md`** — the binding UX pattern every modeling feature follows
3. **`wiki/polysmith.wiki/IPC-Protocol.md`** — communication contract between UI and core
4. **`wiki/polysmith.wiki/Topological-Naming-Problem.md`** — the project's mantra: never trust naked OCCT topology indices

### Quick reference

- `wiki/polysmith.wiki/Repository-Map.md` — directory layout and ownership
- `wiki/polysmith.wiki/AI-CAD-Command-Language.md` — IPC command reference for AI agents
- `wiki/polysmith.wiki/V1-Roadmap.md` — current priorities
- `wiki/polysmith.wiki/Implementation-Log.md` — what's been shipped

## Rules

- React (UI) must NOT own CAD state. CAD state, geometry, and modeling logic live ONLY in the native core.
- Communication between UI and core must go through the IPC protocol. Do not bypass it.
- Do not make architectural changes without explicit approval.
- Keep changes minimal and scoped. No large vibe-coded rewrites.
- Add tests for non-trivial logic. Do not break existing behavior without explanation.
- When adding new documentation, create the file in `wiki/polysmith.wiki/` and add a link from `wiki/polysmith.wiki/Home.md`.
- Cross-reference wiki pages by their title-cased name without extension (e.g., `Architecture-Overview`).
