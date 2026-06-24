## 1. Add `pack` convenience script to root package.json

- [x] 1.1 Add `"pack": "npm run build && npm pack"` to root `package.json` scripts.
- [x] 1.2 Verify `npm run pack` produces `bosch-sdlc-0.1.0.tgz` at the repo root.

## 2. Create `install.sh` (macOS / Linux)

- [x] 2.1 Scaffold `install.sh` at repo root with bash shebang, `set -euo pipefail`, and a banner print (`Bosch SDLC — Install Wizard`).
- [x] 2.2 Implement OS detection via `uname -s` (Darwin = macOS, Linux = Linux). Print detected OS and architecture (`uname -m`).
- [x] 2.3 Implement `--tgz <path>` flag parsing. If provided, validate the file exists and is `.tgz`. If not provided, glob for `bosch-sdlc-*.tgz` in the script's directory, sort by semver, pick the highest. Exit with error if none found.
- [x] 2.4 Implement Node.js check: `node --version`, parse major version, require >= 20. If missing or outdated:
  - macOS: check for `brew`, offer `brew install node@22`. If no `brew`, suggest Homebrew install or https://nodejs.org.
  - Linux: offer nvm install (`curl` nvm script, `nvm install 22`). Source nvm inline so the rest of the script sees the new node.
  - If user declines, exit with a message pointing to https://nodejs.org.
- [x] 2.5 Implement npm check: `npm --version`. If missing after Node install, print error and exit.
- [x] 2.6 Implement package installation: `npm install -g <tarball>`. On Linux without nvm, check if npm global prefix is writable; if not, use `sudo`. After install, verify `command -v bosch-sdlc` succeeds. If not, print `npm bin -g` and the PATH export line to add.
- [x] 2.7 Implement app launch: run `bosch-sdlc &`, poll `curl -s -o /dev/null -w "%{http_code}" http://localhost:PORT` for ports 3742-3745, up to 15 seconds. Print the reachable URL on success, a warning on timeout.
- [x] 2.8 Implement desktop shortcut creation:
  - macOS: write `~/Desktop/Bosch-SDLC.command` with `#!/bin/bash\nbosch-sdlc`, `chmod +x`.
  - Linux: write `~/Desktop/Bosch-SDLC.desktop` with XDG desktop entry, `chmod +x`, `gio set` trusted if available.
- [x] 2.9 Implement summary output block with app version, URL, shortcut path, data directory, manual start command, and uninstall command.
- [x] 2.10 Test on macOS: run `install.sh` with a tarball produced by `npm run pack`. Verify Node check, install, launch, and shortcut.

## 3. Create `install.ps1` (Windows)

- [x] 3.1 Scaffold `install.ps1` at repo root with `$ErrorActionPreference = "Stop"` and banner print.
- [x] 3.2 Implement `--tgz` parameter (`param()` block). If not provided, glob for `bosch-sdlc-*.tgz` in the script's directory, sort by version, pick highest. Exit with error if none found.
- [x] 3.3 Implement Node.js check: `node --version`, parse major version, require >= 20. If missing or outdated, offer `winget install OpenJS.NodeJS.LTS`. If user declines, exit with a message pointing to https://nodejs.org. After winget install, refresh PATH via `$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")`.
- [x] 3.4 Implement npm check: `npm --version`. If missing, print error and exit.
- [x] 3.5 Implement package installation: `npm install -g <tarball>`. After install, verify `Get-Command bosch-sdlc` succeeds. If not, print the npm global prefix and instruct the user to add it to PATH via System Settings or `[Environment]::SetEnvironmentVariable`.
- [x] 3.6 Implement app launch: `Start-Process bosch-sdlc -WindowStyle Hidden`. Poll `Invoke-WebRequest http://localhost:PORT` for ports 3742-3745, up to 15 seconds. Print reachable URL or warning.
- [x] 3.7 Implement desktop shortcut: create `~/Desktop/Bosch-SDLC.lnk` via `WScript.Shell` COM object pointing to the `bosch-sdlc` executable path.
- [x] 3.8 Implement summary output block matching the bash version.

## 4. Verify end-to-end

- [x] 4.1 On macOS: `npm run pack`, copy `bosch-sdlc-*.tgz` + `install.sh` to a temp folder, run `bash install.sh`. Confirm app launches and desktop shortcut works.
- [ ] 4.2 On Linux (or Linux VM/container): same flow with `install.sh`.
- [ ] 4.3 On Windows (or Windows VM): same flow with `powershell -ExecutionPolicy Bypass -File install.ps1`.
