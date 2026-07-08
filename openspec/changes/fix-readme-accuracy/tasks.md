## 1. Rebrand user-facing name to claudboard

- [x] 1.1 Change the README title from `# bosch-sdlc` to `# claudboard`.
- [x] 1.2 In "What it is" and "Who it's for", refer to the product as **claudboard**. Rewrite the "What it is" opening sentence to start "claudboard is a web-based dashboard…".
- [x] 1.3 Add one line near the top explaining the naming split, e.g.: "claudboard ships as the `bosch-sdlc` npm package — the CLI command, the `BOSCH_SDLC_PORT` env var, the `~/.bosch-sdlc/` config directory, and the `bosch` MCP server keep that internal name."
- [x] 1.4 Leave every literal command/path/identifier unchanged: `npx bosch-sdlc`, `BOSCH_SDLC_PORT`, `~/.bosch-sdlc/state.db`, `~/.bosch-sdlc/transcripts/`, `mcp__bosch__*`, `@bosch-sdlc/protocol`. Verify none were rebranded by accident.

## 2. Fix factual errors

- [x] 2.1 In "Development", change the server port from `3001` to `3742` (matches `server/src/dev.ts:19`). Note the Vite dev server proxies both `/api` and `/ws` to it.
- [x] 2.2 Rewrite the "Prerequisite: the claudboard plugin must be installed at … git clone" block: describe automatic first-boot install via `claude plugin install claudboard@claudboard`, run in the background, surfaced by the "Setting up…" card with a Retry button on failure. Remove the manual `git clone` instructions. Link the plugin repo `https://github.com/BD-AI-SDLC/claudboard`.
- [x] 2.3 Ensure line 15's "installed automatically on first boot" statement and the (now rewritten) skills-panel prerequisite agree with each other.
- [x] 2.4 Correct the prereq slash-command names to `/claudboard:claudboard-analyse`, `/claudboard:claudboard-generate`, `/claudboard:claudboard-workflow`, `/claudboard:claudboard-refresh`, `/claudboard:claudboard-techdebt` — consistently in both the Prerequisites list and the "Launching claudboard skills" section.
- [x] 2.5 Fix the phase description: keep "seven phases" but replace the ten-item parenthetical with a 7-step list (or drop the phase framing). Align with the Kickoff preview "1 → 7 · 1 human gate after spec + plan".

## 3. Sync stale UI vocabulary

- [x] 3.1 Update screen/nav references to current sidebar labels (`ui/src/components/primitives/Sidebar.tsx:83-140`): "Dashboard" → **Overview**, "Project screen" → **Project setup**, "Kickoff" → **Start feature**. Keep "Active run" and "Review gate".
- [x] 3.2 In the Architecture / Active Run description, change the "Stream" pane name to **Live stream** (`ui/src/components/ActiveRun/ActiveRun.tsx:447`); "Pipeline" and "Telemetry" are unchanged.
- [x] 3.3 In "Who it's for", remove the stale `bosch-workflow` / `claude-repo-scan` toolchain reference; describe the audience in terms of the claudboard toolchain and the generated `feature-workflow` skill.

## 4. Reconcile entry points

- [x] 4.1 In "Quickstart", add a cross-reference to `INSTALLATION.md` for the install-wizard / tarball path, so `npx bosch-sdlc` and the script install read as complementary, not competing.

## 5. Verify

- [x] 5.1 Re-read the edited README end-to-end for internal consistency: no remaining `3001`, no `git clone` plugin instructions, command names uniform, "claudboard" used for the product and `bosch-sdlc` only for literal identifiers.
- [x] 5.2 Cross-check every factual claim once more against source: port (`server/src/bin.ts:30`), install command (`server/src/bootstrap/installer.ts:20`), command names (`server/src/prereq/cli-runner.ts:15-19`), phase count (`ui/src/components/Kickoff/Kickoff.tsx:187`), nav labels (`Sidebar.tsx`).
- [x] 5.3 Confirm the change stayed in scope: only `README.md` edited; no code, no other docs, no workspaces content added.
