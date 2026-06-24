# Bosch SDLC -- Installation Guide

## Prerequisites

Before installing, make sure you have:

1. **Node.js >= 20** -- check with `node --version`. Download from [nodejs.org](https://nodejs.org) if not installed.
2. **npm** -- ships with Node.js. Check with `npm --version`.
3. **Claude Code** -- installed and available as `claude` on your PATH. Install from [claude.ai/download](https://claude.ai/download).
4. **At least one MCP server** configured in `~/.claude/` (e.g. Atlassian for JIRA, Azure DevOps). See the [MCP docs](https://docs.claude.ai/en/docs/claude-code/mcp) for setup instructions.

## Option A: Install with the Install Wizard (recommended)

The install wizard checks prerequisites, installs the app globally, creates a desktop shortcut, and launches the app automatically.

### macOS / Linux

```sh
bash install.sh
```

### Windows (PowerShell)

```powershell
.\install.ps1
```

The wizard will:

1. Detect your OS and architecture
2. Check for Node.js >= 20 and offer to install it if missing (Homebrew on macOS, nvm on Linux, winget on Windows)
3. Locate the `bosch-sdlc-*.tgz` tarball in the script directory, or build one from source if running from the repository
4. Install the package globally via `npm install -g`
5. Launch the app and open it in your browser
6. Create a desktop shortcut for future launches

### Specifying a tarball

If the tarball is in a different location, pass it explicitly:

```sh
bash install.sh --tgz /path/to/bosch-sdlc-0.1.0.tgz
```

```powershell
.\install.ps1 -tgz C:\path\to\bosch-sdlc-0.1.0.tgz
```

## Option B: Install from tarball manually

If you have a `bosch-sdlc-*.tgz` file and prefer to install without the wizard:

```sh
npm install -g bosch-sdlc-0.1.0.tgz
```

Then start the app:

```sh
bosch-sdlc
```

## Option C: Install from source

Clone the repository and run the install wizard -- it will build the tarball automatically:

```sh
git clone <repo-url>
cd Bosch-SDLC
bash install.sh
```

Or build and install manually:

```sh
npm install
npm run pack
npm install -g bosch-sdlc-0.1.0.tgz
```

## Launching the app

After installation, start the app with:

```sh
bosch-sdlc
```

The server picks a free port (default `3742`), opens your browser automatically, and is ready to use. If the browser doesn't open, navigate to [http://localhost:3742](http://localhost:3742).

A desktop shortcut is also created during installation:

| OS      | Shortcut location                        |
|---------|------------------------------------------|
| macOS   | `~/Desktop/Bosch-SDLC.command`           |
| Linux   | `~/Desktop/Bosch-SDLC.desktop`           |
| Windows | `~/Desktop/Bosch-SDLC.lnk`              |

## Upgrading

Run the install wizard again with a newer tarball -- it detects the existing installation and upgrades in place:

```sh
bash install.sh
```

Or manually:

```sh
npm install -g bosch-sdlc-0.2.0.tgz
```

## Uninstalling

```sh
npm uninstall -g bosch-sdlc
```

App data is stored in `~/.bosch-sdlc/` and is not removed by uninstall. Delete it manually if no longer needed:

```sh
rm -rf ~/.bosch-sdlc
```

## Troubleshooting

### "bosch-sdlc requires Claude Code"

Claude Code is not installed or `~/.claude/` does not exist. Install Claude Code from [claude.ai/download](https://claude.ai/download).

### "bosch-sdlc requires at least one MCP server"

No MCP servers are configured in your Claude Code installation. Add at least one server (e.g. Atlassian or Azure DevOps) following the [MCP setup guide](https://docs.claude.ai/en/docs/claude-code/mcp).

### "bosch-sdlc is not on your PATH"

The npm global bin directory is not in your PATH. Add it:

```sh
# macOS / Linux (zsh)
echo 'export PATH="$(npm config get prefix)/bin:$PATH"' >> ~/.zshrc && source ~/.zshrc

# macOS / Linux (bash)
echo 'export PATH="$(npm config get prefix)/bin:$PATH"' >> ~/.bashrc && source ~/.bashrc
```

```powershell
# Windows
[Environment]::SetEnvironmentVariable('Path', "$(npm config get prefix);" + $env:Path, 'User')
```

### App doesn't respond after launch

The app may take a few seconds to start. If it doesn't respond within 15 seconds, check if the port is in use:

```sh
lsof -i :3742
```

Try the next ports in sequence: `3743`, `3744`, `3745`.
