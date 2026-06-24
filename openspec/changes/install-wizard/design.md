## Context

Bosch SDLC is a monorepo that produces a single npm package (`bosch-sdlc`) with a CLI binary entry point at `server/dist/bin.js`. The package is distributed as a tarball produced by `npm pack`. At runtime the app starts an HTTP + WebSocket server, auto-picks a port in 3742-3841, and opens the browser. It stores state in `~/.bosch-sdlc/state.db` (SQLite, auto-created on first boot).

The wizard must work on machines that may have *nothing* installed — no Node, no npm, no build tools. Since Node may be absent, the wizard cannot be a Node script; it must be a shell script (bash for Unix, PowerShell for Windows).

## Goals / Non-Goals

**Goals:**

- A single command installs the app from a local tarball on macOS, Linux, or Windows.
- Missing prerequisites (Node >= 20, npm) are detected and the user is guided through installation.
- After installation, the app is launched and verified reachable.
- A desktop shortcut is created so the user can launch the app without a terminal.

**Non-Goals:**

- Auto-updating. The wizard installs once; updates are a separate concern.
- Managing Claude Code or API keys. Those are the user's responsibility.
- Installing the claudboard plugin. Deferred to a later change.
- Network-based distribution (npm registry, GitHub releases). The wizard works with a local `.tgz` file co-located with the script.

## Decisions

### D1. Two scripts, not one polyglot

**Choice:** `install.sh` (bash, macOS + Linux) and `install.ps1` (PowerShell, Windows).

**Why:**

- Bash and PowerShell are the native shells on their respective platforms. A polyglot script (or a single bash script requiring Git Bash on Windows) adds friction and fragility.
- The OS-specific logic diverges significantly: package managers (brew vs apt vs winget), desktop shortcut formats (.command vs .desktop vs .lnk), and path conventions. Two clean scripts beats one tangled one.
- Both scripts share the same logical flow, so maintaining two is not a burden.

### D2. The wizard auto-detects the tarball by glob, with a flag override

**Choice:** The script looks for `bosch-sdlc-*.tgz` in the same directory as itself. If multiple are found, it picks the one with the highest semver. The user can override with `--tgz <path>`.

**Why:**

- Zero-config for the common case: download wizard + tarball into the same folder, run the wizard.
- The `--tgz` flag handles edge cases (tarball in a different directory, multiple versions present and the user wants a specific one).
- Glob + semver sort is a few lines of bash; no external dependencies needed.

### D3. Node installation is offered, not forced

**Choice:** If Node is missing or below v20, the wizard prints what's needed and offers to install it. If the user declines, the wizard exits with a message pointing to https://nodejs.org.

**Why:**

- Silently installing Node (or switching versions) can break other projects on the machine. The wizard must not be destructive.
- The install methods differ by OS: Homebrew on macOS, nvm on Linux (apt's Node is usually outdated), winget on Windows. Each is a one-liner but the user should consent.

**Install methods by OS:**

| OS | Method | Command |
|----|--------|---------|
| macOS | Homebrew | `brew install node@22` |
| Linux | nvm | `curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh \| bash && nvm install 22` |
| Windows | winget | `winget install OpenJS.NodeJS.LTS` |

### D4. Desktop shortcut launches a fresh `bosch-sdlc` process

**Choice:** The shortcut runs `bosch-sdlc` (which auto-picks a port and opens the browser). It does not try to connect to an existing instance.

**Why:**

- The app handles port conflicts gracefully (scans 3742-3841). If an instance is already running, the user gets a second one on a different port or sees the port-in-use error. No complex "detect and connect" logic needed in the shortcut.
- Keeping the shortcut as a simple launcher means it never breaks when the app's internals change.

**Shortcut formats:**

| OS | Format | Details |
|----|--------|---------|
| macOS | `~/Desktop/Bosch-SDLC.command` | Bash script, `chmod +x`, Terminal opens and runs `bosch-sdlc` |
| Linux | `~/Desktop/Bosch-SDLC.desktop` | XDG `.desktop` file, `Exec=bosch-sdlc`, `Terminal=true` |
| Windows | `~/Desktop/Bosch-SDLC.lnk` | COM `WScript.Shell` shortcut pointing to `node bosch-sdlc` |

### D5. The wizard verifies the install by checking the binary exists and is callable

**Choice:** After `npm install -g`, the wizard runs `bosch-sdlc --version` (or `command -v bosch-sdlc`) to confirm the binary is on PATH. If it isn't, it prints the npm global bin path and suggests the user add it to PATH.

**Why:**

- `npm install -g` on some systems installs to a directory not on PATH (common on Linux without nvm). The wizard must catch this rather than leaving the user with a "command not found" after a seemingly successful install.
- Printing the exact directory (`npm bin -g`) and the shell rc line to add gives the user an actionable fix.

## Risks

- **Homebrew not installed on macOS.** The wizard checks for `brew` before suggesting `brew install node@22`. If Homebrew is absent, it falls back to suggesting the user visit https://nodejs.org or install Homebrew first.
- **Global npm permissions on Linux.** `npm install -g` without nvm may require `sudo`. The wizard detects this (checks if the global prefix is writable) and either suggests `sudo` or recommends nvm.
- **PATH issues after Node install.** On Linux, nvm modifies `~/.bashrc` / `~/.zshrc` but the current shell doesn't pick it up until sourced. The wizard sources the nvm script inline after install so the rest of the script runs with the new Node.
- **Windows execution policy.** PowerShell scripts may be blocked by default. The wizard should be runnable via `powershell -ExecutionPolicy Bypass -File install.ps1`.
