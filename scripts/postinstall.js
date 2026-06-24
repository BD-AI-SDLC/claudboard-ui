const { existsSync, mkdirSync, symlinkSync, rmSync, realpathSync } = require('node:fs')
const { join, resolve } = require('node:path')

const root = resolve(__dirname, '..')
const protocolSrc = join(root, 'protocol')
const nmDir = join(root, 'node_modules', '@bosch-sdlc')
const target = join(nmDir, 'protocol')

if (!existsSync(protocolSrc)) process.exit(0)

try {
  if (existsSync(target)) {
    const real = realpathSync(target)
    const realSrc = realpathSync(protocolSrc)
    if (real === realSrc) process.exit(0)
  }
} catch {}

try { rmSync(target, { recursive: true, force: true }) } catch {}
mkdirSync(nmDir, { recursive: true })
symlinkSync(protocolSrc, target)
