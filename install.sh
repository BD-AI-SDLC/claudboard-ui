#!/usr/bin/env bash
set -euo pipefail

# ============================================
#   Bosch SDLC -- Install Wizard
# ============================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARBALL=""
APP_URL=""

# ---- Helpers ---------------------------------------------------------------

info()  { printf "\033[1;34m[info]\033[0m  %s\n" "$*"; }
ok()    { printf "\033[1;32m[ok]\033[0m    %s\n" "$*"; }
warn()  { printf "\033[1;33m[warn]\033[0m  %s\n" "$*"; }
err()   { printf "\033[1;31m[error]\033[0m %s\n" "$*"; }
fatal() { err "$*"; exit 1; }

ask_yes_no() {
  local prompt="$1"
  while true; do
    printf "%s [y/n] " "$prompt"
    read -r answer
    case "$answer" in
      [Yy]*) return 0 ;;
      [Nn]*) return 1 ;;
      *) echo "Please answer y or n." ;;
    esac
  done
}

# ---- Parse arguments -------------------------------------------------------

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tgz)
      shift
      [[ $# -eq 0 ]] && fatal "--tgz requires a path argument."
      TARBALL="$1"
      ;;
    --help|-h)
      echo "Usage: install.sh [--tgz <path>]"
      echo ""
      echo "Installs Bosch SDLC from a local tarball."
      echo "If --tgz is omitted, looks for bosch-sdlc-*.tgz in the script directory."
      exit 0
      ;;
    *)
      fatal "Unknown argument: $1. Use --help for usage."
      ;;
  esac
  shift
done

# ---- Banner ----------------------------------------------------------------

echo ""
echo "============================================"
echo "  Bosch SDLC -- Install Wizard"
echo "============================================"
echo ""

# ---- Step 1: Detect OS -----------------------------------------------------

OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Darwin) OS_NAME="macOS" ;;
  Linux)  OS_NAME="Linux" ;;
  *)      fatal "Unsupported operating system: $OS. Use install.ps1 on Windows." ;;
esac

info "Detected: $OS_NAME ($ARCH)"
echo ""

# ---- Step 2: Check Node.js -------------------------------------------------

install_node_macos() {
  if command -v brew &>/dev/null; then
    if ask_yes_no "Install Node.js 22 via Homebrew?"; then
      info "Running: brew install node@22"
      brew install node@22
      brew link --overwrite node@22 2>/dev/null || true
    else
      echo ""
      echo "Please install Node.js >= 20 from https://nodejs.org and re-run this script."
      exit 1
    fi
  else
    echo ""
    echo "Node.js >= 20 is required but not installed."
    echo ""
    echo "Options:"
    echo "  1. Install Homebrew first:  /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
    echo "     Then run:  brew install node@22"
    echo "  2. Download directly from https://nodejs.org"
    echo ""
    echo "After installing Node.js, re-run this script."
    exit 1
  fi
}

install_node_linux() {
  if ask_yes_no "Install Node.js 22 via nvm (Node Version Manager)?"; then
    info "Installing nvm..."
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash

    export NVM_DIR="${HOME}/.nvm"
    # shellcheck disable=SC1091
    [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

    info "Installing Node.js 22..."
    nvm install 22
    nvm use 22
  else
    echo ""
    echo "Please install Node.js >= 20 from https://nodejs.org and re-run this script."
    exit 1
  fi
}

check_node() {
  if command -v node &>/dev/null; then
    local node_version
    node_version="$(node --version | sed 's/^v//')"
    local major
    major="$(echo "$node_version" | cut -d. -f1)"

    if [[ "$major" -ge 20 ]]; then
      ok "Node.js $node_version"
      return
    else
      warn "Node.js $node_version found, but >= 20 is required."
    fi
  else
    warn "Node.js not found."
  fi

  echo ""
  case "$OS_NAME" in
    macOS) install_node_macos ;;
    Linux) install_node_linux ;;
  esac

  if ! command -v node &>/dev/null; then
    fatal "Node.js installation failed. Please install manually from https://nodejs.org"
  fi

  local node_version
  node_version="$(node --version | sed 's/^v//')"
  ok "Node.js $node_version installed"
}

check_node

# ---- Step 2b: Check npm ----------------------------------------------------

if command -v npm &>/dev/null; then
  ok "npm $(npm --version)"
else
  fatal "npm not found. It should have been installed with Node.js. Please reinstall Node from https://nodejs.org"
fi

echo ""

# ---- Step 3: Find tarball ---------------------------------------------------

if [[ -n "$TARBALL" ]]; then
  [[ ! -f "$TARBALL" ]] && fatal "Tarball not found: $TARBALL"
  [[ "$TARBALL" != *.tgz ]] && fatal "File is not a .tgz: $TARBALL"
  info "Using tarball: $TARBALL"
else
  if [[ -f "$SCRIPT_DIR/package.json" ]]; then
    shopt -s nullglob
    old_tarballs=("$SCRIPT_DIR"/bosch-sdlc-[0-9]*.tgz)
    shopt -u nullglob
    for old in "${old_tarballs[@]+"${old_tarballs[@]}"}"; do
      info "Removing old tarball: $(basename "$old")"
      rm -f "$old"
    done

    info "Building tarball from source..."
    (cd "$SCRIPT_DIR" && npm install && npm run pack) || fatal "Build failed. Check the output above."
    shopt -s nullglob
    tarballs=("$SCRIPT_DIR"/bosch-sdlc-[0-9]*.tgz)
    shopt -u nullglob
    [[ ${#tarballs[@]} -eq 0 ]] && fatal "Build completed but no tarball was produced."
    ok "Tarball built successfully."
  else
    shopt -s nullglob
    tarballs=("$SCRIPT_DIR"/bosch-sdlc-[0-9]*.tgz)
    shopt -u nullglob
    [[ ${#tarballs[@]} -eq 0 ]] && fatal "No bosch-sdlc-*.tgz found in $SCRIPT_DIR. Place the tarball in the same directory as this script, or use --tgz <path>."
  fi

  if [[ ${#tarballs[@]} -eq 1 ]]; then
    TARBALL="${tarballs[0]}"
  else
    TARBALL="$(printf '%s\n' "${tarballs[@]}" | sort -V | tail -1)"
  fi

  info "Found tarball: $(basename "$TARBALL")"
fi

# ---- Step 4: Check for existing install ------------------------------------

if command -v bosch-sdlc &>/dev/null; then
  info "Existing installation found -- upgrading."
fi

# ---- Step 5: Install package -----------------------------------------------

info "Installing bosch-sdlc globally..."

NEEDS_SUDO=false
if [[ "$OS_NAME" == "Linux" ]]; then
  NPM_PREFIX="$(npm config get prefix)"
  if [[ ! -w "$NPM_PREFIX/lib" ]]; then
    if command -v nvm &>/dev/null || [[ -n "${NVM_DIR:-}" ]]; then
      NEEDS_SUDO=false
    else
      warn "npm global prefix ($NPM_PREFIX) is not writable. Using sudo."
      NEEDS_SUDO=true
    fi
  fi
fi

if $NEEDS_SUDO; then
  sudo npm install -g "$TARBALL"
else
  npm install -g "$TARBALL"
fi

if command -v bosch-sdlc &>/dev/null; then
  ok "bosch-sdlc installed at $(command -v bosch-sdlc)"
else
  NPM_BIN="$(npm bin -g 2>/dev/null || npm config get prefix)/bin"
  warn "bosch-sdlc is not on your PATH."
  echo ""
  echo "  Add the npm global bin directory to your PATH:"
  echo ""
  if [[ -f "$HOME/.zshrc" ]]; then
    echo "    echo 'export PATH=\"$NPM_BIN:\$PATH\"' >> ~/.zshrc && source ~/.zshrc"
  else
    echo "    echo 'export PATH=\"$NPM_BIN:\$PATH\"' >> ~/.bashrc && source ~/.bashrc"
  fi
  echo ""
  echo "  Then re-run this script, or start the app with: $NPM_BIN/bosch-sdlc"
  exit 1
fi

APP_VERSION="$(node -e "console.log(require('$(npm root -g)/bosch-sdlc/package.json').version)" 2>/dev/null || echo "unknown")"

echo ""

# ---- Step 6: Launch the app ------------------------------------------------

info "Launching bosch-sdlc..."

bosch-sdlc &
APP_PID=$!

FOUND_PORT=""
for i in $(seq 1 15); do
  for port in 3742 3743 3744 3745; do
    if curl -s -o /dev/null -w "" "http://localhost:$port" 2>/dev/null; then
      FOUND_PORT="$port"
      break 2
    fi
  done
  sleep 1
done

if [[ -n "$FOUND_PORT" ]]; then
  APP_URL="http://localhost:$FOUND_PORT"
  ok "App is running at $APP_URL"
else
  warn "App did not respond within 15 seconds. It may still be starting."
  warn "Try opening http://localhost:3742 in your browser."
  APP_URL="http://localhost:3742"
fi

echo ""

# ---- Step 7: Desktop shortcut ----------------------------------------------

SHORTCUT_PATH=""

create_shortcut_macos() {
  SHORTCUT_PATH="$HOME/Desktop/Bosch-SDLC.command"
  cat > "$SHORTCUT_PATH" << 'SHORTCUT'
#!/bin/bash
bosch-sdlc
SHORTCUT
  chmod +x "$SHORTCUT_PATH"
  ok "Desktop shortcut created: $SHORTCUT_PATH"
}

create_shortcut_linux() {
  SHORTCUT_PATH="$HOME/Desktop/Bosch-SDLC.desktop"
  local bosch_bin
  bosch_bin="$(command -v bosch-sdlc)"
  cat > "$SHORTCUT_PATH" << SHORTCUT
[Desktop Entry]
Type=Application
Name=Bosch SDLC
Exec=$bosch_bin
Terminal=true
Icon=utilities-terminal
Categories=Development;
SHORTCUT
  chmod +x "$SHORTCUT_PATH"
  if command -v gio &>/dev/null; then
    gio set "$SHORTCUT_PATH" metadata::trusted true 2>/dev/null || true
  fi
  ok "Desktop shortcut created: $SHORTCUT_PATH"
}

if [[ -d "$HOME/Desktop" ]]; then
  case "$OS_NAME" in
    macOS) create_shortcut_macos ;;
    Linux) create_shortcut_linux ;;
  esac
else
  warn "No ~/Desktop directory found. Skipping shortcut creation."
  SHORTCUT_PATH="(not created)"
fi

echo ""

# ---- Step 8: Summary -------------------------------------------------------

echo "============================================"
echo "  Bosch SDLC -- Installation Complete"
echo "============================================"
echo ""
echo "  App:       bosch-sdlc (version $APP_VERSION)"
echo "  URL:       $APP_URL"
echo "  Shortcut:  ${SHORTCUT_PATH:-(not created)}"
echo "  Data:      ~/.bosch-sdlc/"
echo ""
echo "  To start manually:  bosch-sdlc"
echo "  To uninstall:       npm uninstall -g bosch-sdlc"
echo ""
echo "============================================"
