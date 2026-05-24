# PolySmith Docs → Wiki Migration

**Started:** 2026-05-24
**Status:** Completed — all 14 files migrated, cross-references updated

This document tracks the migration of all content from `docs/` to `wiki/polysmith.wiki/`.
Both directories may be updated independently until the unification is declared complete.
This file lives in `wiki/` root — outside the `polysmith.wiki/` submodule — so it is not
pushed to the GitHub wiki.

## Migration Map

| # | docs/ source | wiki destination | Status | Notes |
|---|---|---|---|---|
| 1 | `architecture/overview.md` | `Architecture-Overview.md` | completed | Cross-refs updated |
| 2 | `architecture/contextual-modeling-workflow.md` | `Contextual-Modeling-Workflow.md` | completed | Binding UX pattern |
| 3 | `architecture/topological-naming-problem.md` | `Topological-Naming-Problem.md` | completed | Project mantra |
| 4 | `architecture/ipc-protocol.md` | `IPC-Protocol.md` | completed | Referenced by many files |
| 5 | `architecture/repo-map.md` | `Repository-Map.md` | completed | docs/ → wiki/ section rewritten |
| 6 | `architecture/sketch-tool-implementation.md` | `Sketch-Tool-Implementation.md` | completed | Implementation guide |
| 7 | `architecture/display-units.md` | `Display-Units.md` | completed | Planned feature |
| 8 | `architecture/ai-cad-command-language.md` | `AI-CAD-Command-Language.md` | completed | 2204 lines — AI agent reference |
| 9 | `DESIGN.md` | `Design-System.md` | completed | Theme system spec |
| 10 | `decisions/0001-tech-stack.md` | `ADR-0001-Tech-Stack.md` | completed | Architectural decision record |
| 11 | `prompts/codex-rules.md` | `Codex-Rules.md` | completed | Overlaps with AGENTS.md |
| 12 | `prompts/tasks.md` | `Task-Templates.md` | completed | AI task templates |
| 13 | `roadmap/v1-roadmap.md` | `V1-Roadmap.md` | completed | |
| 14 | `implementation-log.md` | `Implementation-Log.md` | completed | 828 lines — running log |

## Cross-Reference Updates

### Migrated files (internal docs/ → wiki links)

| File | Old reference | New reference |
|---|---|---|
| `Architecture-Overview.md` | `docs/roadmap/v1-roadmap.md` | `V1-Roadmap` |
| `Contextual-Modeling-Workflow.md` | `docs/architecture/ipc-protocol.md` | `IPC-Protocol` |
| `Contextual-Modeling-Workflow.md` | `docs/DESIGN.md` | `Design-System` |
| `Repository-Map.md` | `docs/` directory tree | update to `wiki/` |
| `Sketch-Tool-Implementation.md` | `docs/architecture/ai-cad-command-language.md` | `AI-CAD-Command-Language` |
| `Sketch-Tool-Implementation.md` | `docs/architecture/ipc-protocol.md` | `IPC-Protocol` |
| `AI-CAD-Command-Language.md` | `docs/architecture/ipc-protocol.md` | `IPC-Protocol` |
| `AI-CAD-Command-Language.md` | `docs/architecture/contextual-modeling-workflow.md` | `Contextual-Modeling-Workflow` |
| `Implementation-Log.md` | `docs/architecture/ipc-protocol.md` | `IPC-Protocol` |

### Existing wiki files (docs/ → wiki links)

| File | Old reference | New reference |
|---|---|---|
| `Unified-Sketch-Interaction-Strategy.md` | `docs/architecture/ipc-protocol.md` | `IPC-Protocol` |
| `Unified-Sketch-Interaction-Strategy.md` | `docs/architecture/ai-cad-command-language.md` | `AI-CAD-Command-Language` |
| `Trim-Tool-Implementation-Plan.md` | `docs/architecture/sketch-tool-implementation.md` | `Sketch-Tool-Implementation` |
| `Trim-Tool-Implementation-Plan.md` | `docs/implementation-log.md` | `Implementation-Log` |

### Repo-root files (docs/ → wiki links)

| File | Old reference | New reference |
|---|---|---|
| `AGENTS.md` | `docs/architecture/ai-cad-command-language.md` | wiki link |
| `AGENTS.md` | `docs/architecture/topological-naming-problem.md` | wiki link |
| `AGENTS.md` | `docs/architecture/contextual-modeling-workflow.md` | wiki link |
| `AGENTS.md` | `docs/DESIGN.md` | wiki link |
| `README.md` | `docs/architecture/overview.md` | wiki link |
| `README.md` | `docs/architecture/ipc-protocol.md` | wiki link |
| `README.md` | `docs/architecture/repo-map.md` | wiki link |
| `README.md` | `docs/roadmap/v1-roadmap.md` | wiki link |
| `README.md` | `docs/decisions/0001-tech-stack.md` | wiki link |
| `CONTRIBUTING.md` | `docs/architecture/overview.md` | wiki link |
| `CONTRIBUTING.md` | `docs/architecture/ipc-protocol.md` | wiki link |
| `CONTRIBUTING.md` | `docs/decisions/0001-tech-stack.md` | wiki link |
| `CONTRIBUTING.md` | `docs/prompts/codex-rules.md` | wiki link |

## Reconciliation Log

| Date | Action |
|---|---|
| 2026-05-24 | Migration started. All 14 docs/ files copied to wiki. |
| 2026-05-24 | All files copied to wiki/polysmith.wiki/ with cross-refs updated. |
| 2026-05-24 | Root files (AGENTS.md, README.md, CONTRIBUTING.md) updated to point to wiki. |
| 2026-05-24 | Source code comments (ipc.ts, sketch_feature.h) updated. |
| 2026-05-24 | Home.md rewritten with all 20 pages organized by category. |
| 2026-05-24 | Repository-Map.md docs/ section rewritten as wiki/ section. |
| 2026-05-24 | Help: `help/trim.md` created, `help-index.ts` updated, Home.md Help section added. |
| 2026-05-24 | Implementation-Log.md updated with trim completion (4 phases + bug fixes). |

## Notes

- `docs/prompts/codex-rules.md` overlaps with `AGENTS.md` at repo root. Both are kept;
  the wiki version serves as the canonical reference.
- After migration completes, `docs/` directory will be deprecated but kept in place
  during a transition period. All new documentation should go into `wiki/`.
- GitHub wiki uses flat `.md` filenames with hyphens for spaces. Internal wiki links
  use the page name without extension (e.g., `Architecture-Overview`).
