## install-scripts

Cross-platform installation wizard for the Bosch SDLC app. Two scripts: `install.sh` (macOS/Linux) and `install.ps1` (Windows).

### Requirements

#### R1. OS Detection

- `install.sh` detects macOS vs Linux via `uname -s`.
- `install.ps1` assumes Windows (PowerShell is Windows-native).
- The script prints the detected OS and architecture at startup.

#### R2. Prerequisite Checks

**Node.js:**
- Check if `node` is on PATH and version is >= 20.
- If missing or outdated, print the issue and offer to install:
  - macOS: `brew install node@22` (check `brew` exists first; if not, suggest Homebrew install or https://nodejs.org).
  - Linux: install via nvm (`curl` the nvm install script, `nvm install 22`). Source nvm inline so the current script session has the new node.
  - Windows: `winget install OpenJS.NodeJS.LTS`.
- If the user declines, exit with a message pointing to https://nodejs.org.

**npm:**
- Check if `npm` is on PATH.
- npm ships with Node; if Node was just installed and npm is still missing, something went wrong — print an error and exit.

#### R3. Tarball Discovery

- Look for `bosch-sdlc-*.tgz` in the same directory as the script.
- If multiple tarballs found, pick the one with the highest semver version number.
- If none found, print an error: "No bosch-sdlc-*.tgz found. Place the tarball in the same directory as this script, or use --tgz <path>."
- Accept a `--tgz <path>` flag to override auto-discovery.
- Validate the file exists and has a `.tgz` extension before proceeding.

#### R4. Install the Package

- Run `npm install -g <tarball-path>`.
- On Linux (non-nvm): check if the npm global prefix is writable. If not, prepend `sudo` and inform the user.
- After install, verify the `bosch-sdlc` binary is on PATH by running `command -v bosch-sdlc` (Unix) or `Get-Command bosch-sdlc` (Windows).
- If the binary is not found, print the npm global bin directory (`npm bin -g`) and instruct the user to add it to their PATH. Provide the exact shell rc line (e.g., `export PATH="$(npm bin -g):$PATH"` appended to `~/.bashrc`).

#### R5. Launch the App

- Run `bosch-sdlc` in the background (Unix: `bosch-sdlc &`; Windows: `Start-Process`).
- Wait up to 15 seconds for the server to become reachable by polling `curl http://localhost:3742` (Unix) or `Invoke-WebRequest` (Windows) in a loop with 1-second intervals. Try ports 3742-3745 since the app auto-selects.
- On success, print the URL the app is listening on.
- On failure (timeout), print a warning but continue to the shortcut step — the user can start manually later.

#### R6. Desktop Shortcut

**macOS (`~/Desktop/Bosch-SDLC.command`):**
```bash
#!/bin/bash
bosch-sdlc
```
- `chmod +x` the file. Terminal.app opens it as a runnable script.

**Linux (`~/Desktop/Bosch-SDLC.desktop`):**
```ini
[Desktop Entry]
Type=Application
Name=Bosch SDLC
Exec=bosch-sdlc
Terminal=true
Icon=utilities-terminal
```
- `chmod +x` the file. Mark as trusted if `gio` is available (`gio set ... metadata::trusted true`).

**Windows (`~/Desktop/Bosch-SDLC.lnk`):**
- Create via PowerShell COM:
  ```powershell
  $ws = New-Object -ComObject WScript.Shell
  $sc = $ws.CreateShortcut("$Home\Desktop\Bosch-SDLC.lnk")
  $sc.TargetPath = (Get-Command bosch-sdlc).Source
  $sc.Save()
  ```

#### R7. Summary Output

At the end, print a summary:

```
============================================
  Bosch SDLC — Installation Complete
============================================

  App:       bosch-sdlc (version X.Y.Z)
  URL:       http://localhost:3742
  Shortcut:  ~/Desktop/Bosch-SDLC.command
  Data:      ~/.bosch-sdlc/

  To start manually:  bosch-sdlc
  To uninstall:       npm uninstall -g bosch-sdlc
============================================
```

#### R8. Idempotency

- If `bosch-sdlc` is already installed globally, the wizard proceeds with `npm install -g` anyway (npm handles the upgrade/reinstall). Print a note: "Existing installation found — upgrading."
- If the desktop shortcut already exists, overwrite it silently.

#### R9. Error Handling

- Every step that can fail prints a clear error message with the failed command and suggested fix.
- The script exits with a non-zero code on fatal errors (Node not installed and user declined, tarball not found, npm install failed).
- Non-fatal issues (shortcut creation failed, app launch timed out) print warnings but do not exit.

### Files

| File | Description |
|------|-------------|
| `install.sh` | Bash wizard for macOS and Linux, placed at repo root |
| `install.ps1` | PowerShell wizard for Windows, placed at repo root |
