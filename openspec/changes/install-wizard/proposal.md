## Why

Bosch SDLC is distributed as a prebuilt npm tarball (`bosch-sdlc-<version>.tgz`). Installing it requires Node >= 20, npm, and the `npm install -g` incantation — reasonable for developers, but a friction point for non-dev team members or fresh machines with nothing installed. There is no guided path from a bare OS to a running app with a desktop shortcut.

An install wizard eliminates this gap. The user downloads the tarball + wizard, runs one command, and the wizard handles prerequisite checks, package installation, first launch, and desktop shortcut creation. Cross-platform (macOS, Linux, Windows).

## What Changes

- **`install.sh`** (macOS / Linux): Bash wizard that detects the OS, checks for Node >= 20 and npm, offers to install them if missing (via Homebrew on macOS, nvm on Linux), installs the tarball globally with `npm install -g`, launches the app, and creates a desktop shortcut (`.command` on macOS, `.desktop` on Linux).
- **`install.ps1`** (Windows): PowerShell wizard with the same flow — checks Node/npm, offers install via `winget`, installs the tarball, launches the app, and creates a desktop shortcut (`.lnk` via COM).
- **`npm run pack`** script in root `package.json`: convenience script that runs `npm run build && npm pack` to produce the distributable tarball.

## Capabilities

### New Capabilities

- `install-scripts`: Cross-platform installation wizard scripts (`install.sh` for macOS/Linux, `install.ps1` for Windows) that check prerequisites, install the app from a local tarball, launch it, and create a desktop shortcut.

### Modified Capabilities

None. The wizard is additive — no existing code is modified.

## Impact

- **Root directory:** `install.sh` and `install.ps1` added at the repo root for distribution alongside the tarball.
- **`package.json`:** One new script (`pack`) for convenience tarball generation.
- **No runtime code changes.** The wizard invokes existing entry points (`npm install -g`, `npx bosch-sdlc`).
- **No breaking changes.** Existing users who install manually are unaffected.
