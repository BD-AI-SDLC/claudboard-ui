## Decision: shell out to `claude` CLI instead of using the Agent SDK for prereqs

### Context

The current `runFeature()` path uses `@anthropic-ai/claude-agent-sdk`'s `query()` and passes the literal slash command as the prompt. The SDK does not preprocess slash commands — that is a Claude Code CLI feature. The CLI tokenizes the prompt, recognizes the leading `/`, looks up the command (resolving it against user-scope plugins, the project's `.claude/skills/`, and the user's `~/.claude/commands/`), and rewrites the prompt to the resolved skill body before the LLM ever sees it.

We considered four alternative approaches before settling here:

| Approach | Description | Disqualifier |
|---|---|---|
| **A: plain-text trigger** | Replace `"/analyse"` with `"Analyse this repository, write the report to .claude/reports/claudboard-analysis.md"` and rely on skill-description matching | Only works when the claudboard plugin is loaded into the SDK session, which depends on `settingSources` config and may not be silent across all target repos. Silent failure mode survives. |
| **B: shell out to `claude --print /<cmd>`** | This proposal. | n/a |
| **C: generate `bosch-<cmd>` adapter skills into the target repo** | A `/claudboard-workflow`-style generator writes instrumented skills into `<target>/.claude/skills/` per command. | Requires a setup step (either a terminal command or a "Run setup" button), violating the "land and press" goal. Even C-fat (vendoring the full skill body per repo) requires the generation step to land somewhere. |
| **E: embed full prompts in bosch-sdlc and use SDK** | Vendor `analyse.md`, `generate.md` etc. into `server/prompts/` and pass them to `query()` directly. | Largest diff. Vendors significant content that drifts from claudboard upstream. Justified later if step-by-step progress UX is needed; not justified for "make it work." |

### Decision

Spawn `claude --print --output-format stream-json --verbose /<cmd>` as a child process with `cwd = target`. Stream stdout, parse each line as JSON, persist + broadcast.

### Why this is the smallest-diff path that meets the constraint

- The CLI already does the slash-command preprocessing and plugin resolution. We don't have to reimplement it.
- The CLI uses the user's existing `~/.claude/` config for auth, MCP servers, and plugin state — no new auth path needed in bosch-sdlc.
- The stream-json output format is line-delimited JSON, easy to parse and broadcast as-is via the existing `transcript-message` WebSocket envelope.
- When claudboard upstream improves `/analyse`, users get the improvement on their next plugin update — no bosch-sdlc release needed.
- Two execution paths (SDK for feature-workflow, CLI for prereqs) coexist comfortably because they are scoped by `kind` on the runs table; nothing in the run-driver or gate paths needs to branch.

### Why not unify the feature flow onto the same CLI path

Start Feature works today via the SDK because the bosch in-process MCP server is attached to the same query and the `feature-workflow` skill calls typed `mcp__bosch__*` tools. To route Start Feature through the CLI we would need to expose the bosch MCP server over stdio or HTTP so the CLI subprocess could connect to it via `--mcp-config`. That's a non-trivial refactor for zero functional gain. The two paths are clearly scoped and stay separate.

## Decision: silent claudboard plugin install on first boot

### Context

Prereq slash commands resolve against the user-scope claudboard plugin. If the plugin is not installed in `~/.claude/plugins/marketplaces/claudboard/`, the CLI will fail to find the command. The plugin is a one-line `claude plugin install` away, but requiring the user to run a terminal command violates the "land and press" goal.

### Decision

After the existing Claude Code precondition check passes (CLI on PATH, `~/.claude/` exists), the server inspects `~/.claude/plugins/marketplaces/claudboard/skills/claudboard-analyse/SKILL.md`. If present, bootstrap state is `ready` immediately. If absent, the server spawns `claude plugin install claudboard@claudboard` in the background and exposes the state via `GET /api/bootstrap/status`. The UI shows a small non-dismissible "Setting up…" card on the Dashboard while state is not `ready`. On install failure the card surfaces the error and offers a Retry button calling `POST /api/bootstrap/retry`.

### Why silent, not prompted

We considered three install UX options:

| Option | Description | Trade-off |
|---|---|---|
| **Silent on boot** | Server starts the install without asking; UI shows progress. | One-time write to `~/.claude/plugins/` without explicit consent. Acceptable given the user just ran `npx bosch-sdlc`, which is itself implicit consent to set up the toolchain. |
| **Prompted** | "Install the claudboard plugin? [Install] [Cancel]" before proceeding. | One extra click on first boot. Most honest about what's happening on disk. |
| **Refuse to start** | Server exits with instructions to run `claude plugin install` manually. | Pushes one terminal command back onto the user, violating the constraint. |

The product owner explicitly chose silent. Justification: `npx bosch-sdlc` is itself an implicit consent to set up the dashboard's runtime, and the plugin landing in `~/.claude/plugins/` is functionally identical to the dashboard installing its own dependencies. The install is idempotent and skipped on subsequent boots.

### Bootstrap state machine

```
                  ┌─────────────────┐
                  │  server start   │
                  └────────┬────────┘
                           │
              CLI on PATH? │
                       no  │  yes
                ┌──────────┴──────────┐
                ▼                     ▼
        ┌──────────────┐   ┌────────────────────┐
        │ cli-missing  │   │ check plugin path  │
        │  (terminal)  │   └─────┬────────┬─────┘
        └──────────────┘     yes │     no │
                                 ▼        ▼
                            ┌────────┐  ┌────────────┐
                            │ ready  │  │ installing │──┐
                            └────────┘  └────────────┘  │
                                  ▲          │          │
                                  │          ▼          │
                                  │     ┌─────────────┐ │
                                  └─────│   install   │ │
                                        │  succeeded  │ │
                                        └─────────────┘ │
                                              │         │
                                  ┌───────────┘         │
                                  │                     │
                                  │     ┌─────────────┐ │
                                  │     │  install    │ │
                                  └─────│   failed    │◄┘
                                  retry └─────────────┘
                                        ▲
                                   POST /bootstrap/retry
```

`cli-missing` is terminal because we explicitly chose not to install Claude Code itself for the user — that's a much larger surface (auth, OAuth, plugin marketplace registration) than installing a single plugin into an already-configured Claude Code. The UI on `cli-missing` shows a card linking to `claude.com/download`.

### Why not auto-update the plugin

The bootstrap check is presence-only. We do not check installed version or auto-update. Reason: silently bumping a user's plugin version can change behavior in `claude /analyse` outside the dashboard, surprising users who use claudboard in the terminal too. Version pinning and update flows are out of scope; if a future change needs them, it can extend the state machine.

## Decision: 503 from `/api/prereqs/:cmd` and `/api/runs` while bootstrap is not ready

### Context

The UI already has loading affordances per OperationCard; we could let prereq POSTs queue or wait. But the simpler contract — "the server is not ready, come back" — is cleaner than queue semantics that would have to deal with stale requests after a 30-second install.

### Decision

Both endpoints return HTTP 503 with `{ error: <bootstrap message>, bootstrapState: <state> }` while bootstrap is `installing`, `cli-missing`, or `install-failed`. The UI disables the relevant action buttons based on `useBootstrapStatus()` and surfaces the bootstrap card, so a user shouldn't see the 503 in practice; it's a defensive lower bound.

We do not gate `GET` endpoints — viewing existing projects, runs, transcripts, and prereq state remains available during install. This matters because a user navigating between pages during a 30-second install shouldn't see the UI lose data.

## Decision: keep `detectPrereqs()` filesystem-based completion detection

### Context

We could parse the stream-json output for a sentinel "/analyse completed, report at <path>" message. We could have the CLI emit a final `tool_use` for `Write` and watch for it. We could time out at 5 minutes and declare failure.

### Decision

When the CLI exits with code 0, treat that as "the command ran to completion as it sees it" and re-run `detectPrereqs(target)`. If the relevant artifact (e.g. `.claude/reports/claudboard-analysis.md` for `analyse`) now exists, the state flips to `done`. If it still doesn't exist, the state stays `missing` and `runs.status` becomes `failed` with `error_message = "Command exited 0 but expected artifact <path> was not written"`.

This mirrors today's intended behavior and avoids tying us to the CLI's stream-json schema, which can change between Claude Code versions. The `detectPrereqs()` paths are already the source of truth for "what's installed in this repo" and the dashboard reads from there.

## Risks and mitigations

- **`claude plugin install claudboard@claudboard` semantics may change.** If the marketplace name or install command changes between Claude Code releases, bootstrap will fail. Mitigation: bootstrap state captures stderr verbatim and surfaces it in the UI; user can see the actual CLI error and either fix manually or retry after upgrading Claude Code.
- **CLI subprocess output buffering.** Some CLIs buffer stdout when not attached to a TTY, producing the appearance of a hang. Mitigation: use `--output-format stream-json --verbose` which Claude Code documents as line-flushed. If we observe buffering in practice, we add `stdio: ['ignore', 'pipe', 'pipe']` with `process.env.PYTHONUNBUFFERED=1`-style equivalents, or fall back to PTY.
- **Concurrent prereq runs against the same repo.** Today the UI doesn't prevent this; the new path inherits the same condition. Mitigation: tracked as a UI concern not part of this change; the OperationCard's `running` state already disables its own button while a run is in flight.
- **Plugin install during active prereq run.** Cannot happen by construction: prereq POSTs return 503 until bootstrap is `ready`.
- **Bootstrap install hangs forever.** Mitigation: a 5-minute hard timeout on the install subprocess; on timeout, state becomes `install-failed` with message `"Plugin install timed out after 5 minutes"`.
