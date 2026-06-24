import { spawn } from 'node:child_process'
import { resolveClaudboard } from '../cost/resolver.js'

export function isClaudboardInstalled(): boolean {
  return resolveClaudboard() !== null
}

export function isClaudeCliPresent(timeoutMs = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('claude', ['--version'], { stdio: 'ignore' })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolve(false)
    }, timeoutMs)
    child.once('error', () => {
      clearTimeout(timer)
      resolve(false)
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      resolve(code === 0)
    })
  })
}
