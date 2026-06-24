import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getDb } from './db.js'

export function ensureBoschSdlcDir(): void {
  const dir = join(homedir(), '.bosch-sdlc')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  mkdirSync(join(dir, 'transcripts'), { recursive: true })
  getDb()
}
