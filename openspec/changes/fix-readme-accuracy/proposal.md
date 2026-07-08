## Why

The root `README.md` has drifted from the shipped product in three ways, and in several places contradicts both the code and itself:

1. **Branding split.** The UI renders the wordmark "claudboard" (`ui/src/components/primitives/Sidebar.tsx:169`), the repo lives at `BD-AI-SDLC/claudboard-ui`, and the plugin/marketplace is `claudboard@claudboard`. But the README is titled `bosch-sdlc` and uses that name throughout (8×). The user-facing product is claudboard; only the *internal* identifiers remain `bosch-sdlc` (package name, `BOSCH_SDLC_PORT`, `~/.bosch-sdlc`, MCP server `bosch`, `@bosch-sdlc/protocol`). The README picks neither lane cleanly.

2. **Factually wrong statements** that will mislead a reader:
   - Dev server port is documented as `3001` (README:50); the code uses **3742** (`server/src/dev.ts:19`, `server/src/bin.ts:30`).
   - The claudboard plugin is described as a manual `git clone <claudboard-repo> ~/.claude/plugins/marketplaces/claudboard` (README:81-85), which contradicts the README's own line 15 and the code: the plugin installs **automatically on first boot** via `claude plugin install claudboard@claudboard` (`server/src/bootstrap/installer.ts:20`, `server/src/bin.ts:54`).
   - Prereq slash commands are listed two different ways — `/analyse … /claudboard-workflow` (README:13) and `/claudboard-analyse …` (README:75-77) — and neither matches the real form `/claudboard:claudboard-<skill>` (`server/src/prereq/cli-runner.ts:15-19`, confirmed against the `claudboard` plugin's `skills/`).
   - "seven phases" is followed by a parenthetical enumerating **ten** steps (README:5); the UI confirms 7 phases with one gate after spec+plan (`ui/src/components/Kickoff/Kickoff.tsx:187`).

3. **Stale UI vocabulary.** Sidebar labels were renamed (`Sidebar.tsx:83-140`): Dashboard→**Overview**, Project screen→**Project setup**, Kickoff→**Start feature**; the Stream pane is now **Live stream** (`ActiveRun.tsx:447`). The README also references a `bosch-workflow` / `claude-repo-scan` toolchain (README:9) that no longer exists anywhere in the code or plugin.

This change corrects the README to match the shipped product. Per decision, it **rebrands the user-facing name to claudboard** (keeping literal commands/paths as-is with a one-line note) and is **fixes-only** — the in-flight workspaces feature (`claudboard-workspace-init` / `-link`, `workspaces-overhaul`) is intentionally out of scope to avoid documenting a moving target.

## What Changes

- **Rebrand the user-facing name to "claudboard" in `README.md`.** Title and prose refer to the product as claudboard. Literal identifiers stay verbatim because they are what the user actually types / where files actually live: the `bosch-sdlc` bin (`npx bosch-sdlc`), `BOSCH_SDLC_PORT`, `~/.bosch-sdlc/`, and the `bosch` MCP server. Add one line near the top explaining the split (e.g. "claudboard ships as the `bosch-sdlc` npm package; the CLI, port env var, and config directory keep that name").
- **Fix the dev server port** in the Development section: `3001` → `3742`; note the Vite dev server proxies both `/api` and `/ws` to it.
- **Rewrite the plugin section** (README:81-88): describe automatic first-boot install (`claude plugin install claudboard@claudboard`, run in the background, surfaced by the "Setting up…" card and a Retry on failure). Remove the manual `git clone` instructions. Reference the plugin repo `https://github.com/BD-AI-SDLC/claudboard`.
- **Correct the prereq slash-command names** to the real `/claudboard:claudboard-analyse | -generate | -workflow | -refresh | -techdebt` form, used consistently in both places they appear.
- **Fix the phase description** (README:5): keep "seven phases" and give a 7-item list, or drop the phase framing for the step list — but stop implying ten phases. Align with "1 → 7 · 1 human gate after spec + plan".
- **Sync UI vocabulary** to current sidebar labels: Overview, Project setup, Start feature, Active run, Review gate; Live stream.
- **Remove the stale `bosch-workflow` / `claude-repo-scan` toolchain reference** (README:9); describe the audience in terms of the claudboard toolchain.
- **Reconcile the two entry points**: have the README Quickstart cross-reference `INSTALLATION.md` (wizard / tarball) so `npx bosch-sdlc` and the install-script path aren't presented as competing stories.
- **No change to:** any code, the internal `bosch-sdlc` identifiers themselves, the `packaging` spec, or `docs/architecture.svg` and `docs/workflow-instrumentation.md` (verified accurate).

## Non-Goals

- **Rebranding `INSTALLATION.md`, `CHANGELOG.md`, `CLAUDE.md`, or code identifiers.** A full `bosch-sdlc → claudboard` rename (package name, env var, config dir) is a separate, larger investigation. This change only makes the README self-consistent and correct, and cross-references INSTALLATION.md rather than rewriting it. See Open Questions.
- **Documenting the workspaces feature.** Deferred until `workspaces-overhaul` lands.

## Capabilities

### Added Capabilities

- **documentation** — introduces a requirement that `README.md` accurately reflects the shipped product: user-facing name, install flow, ports, slash-command names, workflow phase count, and UI navigation labels, while preserving literal `bosch-sdlc` identifiers.

## Impact

- **Docs (`README.md`):** the only file edited. Title, "What it is", "Who it's for", "Prerequisites", "Quickstart", "Development", "Launching claudboard skills from the dashboard", and "Architecture" sections touched.
- **Spec:** new `openspec/specs/documentation/spec.md` on archive (delta in `changes/fix-readme-accuracy/specs/documentation/spec.md`).
- **No code, protocol, test, or build impact.** No behavioral change; nothing to typecheck or run.

## Open Questions

- Should `INSTALLATION.md` (and the desktop-shortcut names "Bosch-SDLC", the tarball `bosch-sdlc-*.tgz`) be rebranded in a follow-up so the two docs stay consistent? Rebranding README alone means a reader who clicks through to INSTALLATION.md sees "Bosch SDLC" again.
- Is the package intended to publish to npm as `bosch-sdlc` (so `npx bosch-sdlc` is real), or is the install-script/tarball path the only supported install? This determines whether the Quickstart's `npx bosch-sdlc` stays as the headline command.
