# ============================================
#   Bosch SDLC -- Install Wizard (Windows)
# ============================================

param(
    [string]$tgz = ""
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$AppUrl = ""

# ---- Helpers ---------------------------------------------------------------

function Write-Info  { param([string]$msg) Write-Host "[info]  $msg" -ForegroundColor Blue }
function Write-Ok    { param([string]$msg) Write-Host "[ok]    $msg" -ForegroundColor Green }
function Write-Warn  { param([string]$msg) Write-Host "[warn]  $msg" -ForegroundColor Yellow }
function Write-Err   { param([string]$msg) Write-Host "[error] $msg" -ForegroundColor Red }
function Write-Fatal { param([string]$msg) Write-Err $msg; exit 1 }

function Ask-YesNo {
    param([string]$Prompt)
    while ($true) {
        $answer = Read-Host "$Prompt [y/n]"
        switch -Regex ($answer) {
            '^[Yy]' { return $true }
            '^[Nn]' { return $false }
            default { Write-Host "Please answer y or n." }
        }
    }
}

# ---- Banner ----------------------------------------------------------------

Write-Host ""
Write-Host "============================================"
Write-Host "  Bosch SDLC -- Install Wizard"
Write-Host "============================================"
Write-Host ""

# ---- Step 1: OS info -------------------------------------------------------

Write-Info "Detected: Windows ($env:PROCESSOR_ARCHITECTURE)"
Write-Host ""

# ---- Step 2: Check Node.js -------------------------------------------------

$nodeOk = $false
try {
    $nodeVersionRaw = & node --version 2>$null
    if ($nodeVersionRaw) {
        $nodeVersion = $nodeVersionRaw -replace '^v', ''
        $major = [int]($nodeVersion.Split('.')[0])
        if ($major -ge 20) {
            Write-Ok "Node.js $nodeVersion"
            $nodeOk = $true
        } else {
            Write-Warn "Node.js $nodeVersion found, but >= 20 is required."
        }
    }
} catch {
    Write-Warn "Node.js not found."
}

if (-not $nodeOk) {
    Write-Host ""
    $wingetAvailable = $false
    try {
        $null = Get-Command winget -ErrorAction Stop
        $wingetAvailable = $true
    } catch {}

    if ($wingetAvailable) {
        if (Ask-YesNo "Install Node.js LTS via winget?") {
            Write-Info "Running: winget install OpenJS.NodeJS.LTS"
            winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
            # Refresh PATH so the current session sees the new node
            $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
        } else {
            Write-Host ""
            Write-Host "Please install Node.js >= 20 from https://nodejs.org and re-run this script."
            exit 1
        }
    } else {
        Write-Host ""
        Write-Host "Node.js >= 20 is required but not installed."
        Write-Host ""
        Write-Host "Options:"
        Write-Host "  1. Install winget (App Installer from Microsoft Store), then run:"
        Write-Host "     winget install OpenJS.NodeJS.LTS"
        Write-Host "  2. Download directly from https://nodejs.org"
        Write-Host ""
        Write-Host "After installing Node.js, re-run this script."
        exit 1
    }

    # Verify node is now available
    try {
        $nodeVersionRaw = & node --version 2>$null
        if (-not $nodeVersionRaw) { throw "not found" }
        $nodeVersion = $nodeVersionRaw -replace '^v', ''
        Write-Ok "Node.js $nodeVersion installed"
    } catch {
        Write-Fatal "Node.js installation failed. Please install manually from https://nodejs.org"
    }
}

# ---- Step 2b: Check npm ----------------------------------------------------

try {
    $npmVersion = & npm --version 2>$null
    if ($npmVersion) {
        Write-Ok "npm $npmVersion"
    } else {
        throw "not found"
    }
} catch {
    Write-Fatal "npm not found. It should have been installed with Node.js. Please reinstall Node from https://nodejs.org"
}

Write-Host ""

# ---- Step 3: Find tarball ---------------------------------------------------

$Tarball = ""
if ($tgz -ne "") {
    if (-not (Test-Path $tgz)) {
        Write-Fatal "Tarball not found: $tgz"
    }
    if ($tgz -notmatch '\.tgz$') {
        Write-Fatal "File is not a .tgz: $tgz"
    }
    $Tarball = (Resolve-Path $tgz).Path
    Write-Info "Using tarball: $Tarball"
} else {
    if (Test-Path (Join-Path $ScriptDir "package.json")) {
        $oldTarballs = Get-ChildItem -Path $ScriptDir -Filter "bosch-sdlc-[0-9]*.tgz" -File
        foreach ($old in $oldTarballs) {
            Write-Info "Removing old tarball: $($old.Name)"
            Remove-Item $old.FullName -Force
        }

        Write-Info "Building tarball from source..."
        Push-Location $ScriptDir
        try {
            & npm install
            if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
            & npm run pack
            if ($LASTEXITCODE -ne 0) { throw "npm run pack failed" }
        } catch {
            Pop-Location
            Write-Fatal "Build failed: $_"
        }
        Pop-Location
        $tarballs = Get-ChildItem -Path $ScriptDir -Filter "bosch-sdlc-[0-9]*.tgz" -File | Sort-Object Name
        if ($tarballs.Count -eq 0) {
            Write-Fatal "Build completed but no tarball was produced."
        }
        Write-Ok "Tarball built successfully."
    } else {
        $tarballs = Get-ChildItem -Path $ScriptDir -Filter "bosch-sdlc-[0-9]*.tgz" -File | Sort-Object Name
        if ($tarballs.Count -eq 0) {
            Write-Fatal "No bosch-sdlc-*.tgz found in $ScriptDir. Place the tarball in the same directory as this script, or use -tgz <path>."
        }
    }
    $Tarball = ($tarballs | Select-Object -Last 1).FullName
    Write-Info "Found tarball: $(Split-Path $Tarball -Leaf)"
}

# ---- Step 4: Check for existing install ------------------------------------

try {
    $existingCmd = Get-Command bosch-sdlc -ErrorAction Stop 2>$null
    if ($existingCmd) {
        Write-Info "Existing installation found -- upgrading."
    }
} catch {}

# ---- Step 5: Install package -----------------------------------------------

Write-Info "Installing bosch-sdlc globally..."

& npm install -g $Tarball
if ($LASTEXITCODE -ne 0) {
    Write-Fatal "npm install failed. Check the output above for details."
}

# Refresh PATH after install
$env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")

$boschCmd = $null
try {
    $boschCmd = Get-Command bosch-sdlc -ErrorAction Stop
    Write-Ok "bosch-sdlc installed at $($boschCmd.Source)"
} catch {
    $npmPrefix = & npm config get prefix
    Write-Warn "bosch-sdlc is not on your PATH."
    Write-Host ""
    Write-Host "  Add the npm global directory to your PATH:"
    Write-Host ""
    Write-Host "    [Environment]::SetEnvironmentVariable('Path', `"$npmPrefix;`" + `$env:Path, 'User')"
    Write-Host ""
    Write-Host "  Then re-run this script, or start the app with: $npmPrefix\bosch-sdlc"
    exit 1
}

# Get version
$AppVersion = "unknown"
try {
    $npmRoot = & npm root -g
    $pkgJson = Get-Content "$npmRoot\bosch-sdlc\package.json" | ConvertFrom-Json
    $AppVersion = $pkgJson.version
} catch {}

Write-Host ""

# ---- Step 6: Launch the app ------------------------------------------------

Write-Info "Launching bosch-sdlc..."

Start-Process -FilePath $boschCmd.Source -WindowStyle Hidden

$FoundPort = ""
for ($i = 1; $i -le 15; $i++) {
    foreach ($port in @(3742, 3743, 3744, 3745)) {
        try {
            $null = Invoke-WebRequest -Uri "http://localhost:$port" -TimeoutSec 1 -ErrorAction Stop
            $FoundPort = $port
            break
        } catch {}
    }
    if ($FoundPort -ne "") { break }
    Start-Sleep -Seconds 1
}

if ($FoundPort -ne "") {
    $AppUrl = "http://localhost:$FoundPort"
    Write-Ok "App is running at $AppUrl"
} else {
    Write-Warn "App did not respond within 15 seconds. It may still be starting."
    Write-Warn "Try opening http://localhost:3742 in your browser."
    $AppUrl = "http://localhost:3742"
}

Write-Host ""

# ---- Step 7: Desktop shortcut ----------------------------------------------

$ShortcutPath = ""
$DesktopDir = [Environment]::GetFolderPath("Desktop")

if (Test-Path $DesktopDir) {
    $ShortcutPath = Join-Path $DesktopDir "Bosch-SDLC.lnk"
    try {
        $ws = New-Object -ComObject WScript.Shell
        $sc = $ws.CreateShortcut($ShortcutPath)
        $sc.TargetPath = $boschCmd.Source
        $sc.WorkingDirectory = $env:USERPROFILE
        $sc.Description = "Launch Bosch SDLC"
        $sc.Save()
        Write-Ok "Desktop shortcut created: $ShortcutPath"
    } catch {
        Write-Warn "Failed to create desktop shortcut: $_"
        $ShortcutPath = "(not created)"
    }
} else {
    Write-Warn "Desktop directory not found. Skipping shortcut creation."
    $ShortcutPath = "(not created)"
}

Write-Host ""

# ---- Step 8: Summary -------------------------------------------------------

Write-Host "============================================"
Write-Host "  Bosch SDLC -- Installation Complete"
Write-Host "============================================"
Write-Host ""
Write-Host "  App:       bosch-sdlc (version $AppVersion)"
Write-Host "  URL:       $AppUrl"
Write-Host "  Shortcut:  $ShortcutPath"
Write-Host "  Data:      $env:USERPROFILE\.bosch-sdlc\"
Write-Host ""
Write-Host "  To start manually:  bosch-sdlc"
Write-Host "  To uninstall:       npm uninstall -g bosch-sdlc"
Write-Host ""
Write-Host "============================================"
