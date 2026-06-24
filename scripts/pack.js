const { execSync } = require('node:child_process')
const { existsSync, lstatSync, readlinkSync, rmSync, symlinkSync } = require('node:fs')
const { join } = require('node:path')

const root = process.cwd()
const linkPath = join(root, 'node_modules', '@bosch-sdlc', 'protocol')

let savedTarget = null

try {
  if (existsSync(linkPath)) {
    if (lstatSync(linkPath).isSymbolicLink()) {
      savedTarget = readlinkSync(linkPath)
    }
    rmSync(linkPath, { recursive: true, force: true })
  }

  execSync('npm pack', { stdio: 'inherit', cwd: root })
} finally {
  if (savedTarget) {
    symlinkSync(savedTarget, linkPath)
  }
}
