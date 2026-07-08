## ADDED Requirements

### Requirement: README reflects the shipped product

The root `README.md` SHALL describe the product using its user-facing name **claudboard**, while preserving the literal package, CLI, config, and MCP identifiers (`bosch-sdlc` npm package, `npx bosch-sdlc`, `BOSCH_SDLC_PORT`, `~/.bosch-sdlc/`, `bosch` MCP server) exactly as they appear in the code, with a one-line note explaining the split. Every command, port, plugin-install instruction, slash-command name, workflow phase count, and UI navigation label stated in the README SHALL match the current implementation.

#### Scenario: Product name and identifier split

- **WHEN** a reader opens `README.md`
- **THEN** the title and prose call the product "claudboard", and a note states that it ships as the `bosch-sdlc` package whose CLI command, `BOSCH_SDLC_PORT` env var, and `~/.bosch-sdlc/` config directory keep the internal name

#### Scenario: Development server port

- **WHEN** the README documents the local dev server port
- **THEN** it states `3742` (not `3001`), matching `server/src/dev.ts` and `server/src/bin.ts`

#### Scenario: Plugin installation

- **WHEN** the README explains how the claudboard plugin becomes available
- **THEN** it describes automatic first-boot installation via `claude plugin install claudboard@claudboard` and does NOT instruct the reader to `git clone` the plugin into `~/.claude/plugins/marketplaces/`

#### Scenario: Prereq slash-command names

- **WHEN** the README lists the claudboard prereq commands
- **THEN** they appear in the form `/claudboard:claudboard-<skill>` (analyse, generate, workflow, refresh, techdebt), consistently everywhere they are mentioned

#### Scenario: Workflow phase count

- **WHEN** the README states the number of workflow phases
- **THEN** the count and any accompanying step list are consistent with the UI ("seven phases", one human gate after spec+plan)

#### Scenario: UI navigation labels

- **WHEN** the README refers to screens in the dashboard sidebar
- **THEN** it uses the current labels: Overview, Project setup, Start feature, Active run, Review gate
