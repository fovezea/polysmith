# PolySmith — Project Onboarding

When starting a new session in this project, read these wiki pages first to
understand the system. They are the canonical documentation; the `docs/`
directory is deprecated and should not be used.

## Reading order (first session)

1. **[Architecture Overview](wiki/Architecture-Overview.md)** — UI / Tauri / C++ core layout
2. **[Contextual Modeling Workflow](wiki/Contextual-Modeling-Workflow.md)** — the binding UX pattern every feature follows
3. **[IPC Protocol](wiki/IPC-Protocol.md)** — how UI and core communicate
4. **[Topological Naming Problem](wiki/Topological-Naming-Problem.md)** — the project's mantra

## Return-session quick-ref

- **[Repository Map](wiki/Repository-Map.md)** — directory layout
- **[AI CAD Command Language](wiki/AI-CAD-Command-Language.md)** — IPC command reference for agents
- **[V1 Roadmap](wiki/V1-Roadmap.md)** — current priorities
- **[Implementation Log](wiki/Implementation-Log.md)** — what's shipped

## Rules

- All documentation lives in `wiki/`. Do not read or write to `docs/`.
- AGENTS.md at repo root is the binding instruction set — read it at session start.
- When adding new docs, create the file in `wiki/` and add a link from `wiki/Home.md`.
- Cross-reference wiki pages by their title-cased name without extension (e.g., `Architecture-Overview`).
