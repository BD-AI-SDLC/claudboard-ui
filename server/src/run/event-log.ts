import { appendFileSync, readFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { WsEvent } from '@bosch-sdlc/protocol'

const EVENTS_DIR = join(homedir(), '.bosch-sdlc', 'run-events')

function logPath(runId: string): string {
  return join(EVENTS_DIR, `${runId}.jsonl`)
}

export function appendEvent(runId: string, event: WsEvent): void {
  mkdirSync(EVENTS_DIR, { recursive: true })
  appendFileSync(logPath(runId), JSON.stringify(event) + '\n', 'utf8')
}

export function readEvents(runId: string): WsEvent[] {
  try {
    const raw = readFileSync(logPath(runId), 'utf8')
    return raw
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as WsEvent)
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
}
