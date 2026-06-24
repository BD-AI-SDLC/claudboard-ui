import { createHttpServer } from './app.js'
import { attachWsServer } from './ws-server.js'
import { getDb } from './db.js'
import { sweepDeadRuns } from './run/sweep.js'
import { runBootstrap } from './bootstrap/state.js'
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const boschDir = join(homedir(), '.bosch-sdlc')
mkdirSync(join(boschDir, 'transcripts'), { recursive: true })
getDb() // initialises DB + runs migrations

sweepDeadRuns()

const { server } = createHttpServer()
attachWsServer(server)

const port = Number(process.env['BOSCH_SDLC_PORT'] ?? 3742)
server.listen(port, () => {
  console.info(`[bosch-sdlc dev] Listening on http://localhost:${port}`)
})

// Same as bin.ts — kick off the bootstrap state machine so the UI can
// transition out of the initial `installing` state.
void runBootstrap()
