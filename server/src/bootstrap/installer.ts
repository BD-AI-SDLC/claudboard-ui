import { spawn } from 'node:child_process'

const INSTALL_TIMEOUT_MS = 5 * 60 * 1000
const STDERR_TAIL_BYTES = 2 * 1024

export interface InstallResult {
  ok: boolean
  stderr?: string
  timedOut?: boolean
}

function truncateTail(s: string, max: number): string {
  if (Buffer.byteLength(s, 'utf8') <= max) return s
  const buf = Buffer.from(s, 'utf8')
  return '[truncated]\n' + buf.subarray(buf.length - max).toString('utf8')
}

export function installClaudboard(): Promise<InstallResult> {
  return new Promise((resolve) => {
    const child = spawn('claude', ['plugin', 'install', 'claudboard@claudboard'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    // stdout is captured but not retained — install progress output is unstable
    // across Claude Code versions and we don't surface it.
    child.stdout.on('data', () => {})

    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL')
      }, 5000)
      resolve({ ok: false, timedOut: true, stderr: 'Plugin install timed out after 5 minutes' })
    }, INSTALL_TIMEOUT_MS)

    child.once('error', (err) => {
      clearTimeout(timer)
      resolve({ ok: false, stderr: `Failed to spawn claude: ${err.message}` })
    })

    child.once('exit', (code) => {
      clearTimeout(timer)
      if (code === 0) {
        resolve({ ok: true })
      } else {
        resolve({ ok: false, stderr: truncateTail(stderr.trim() || `claude exited ${code}`, STDERR_TAIL_BYTES) })
      }
    })
  })
}
