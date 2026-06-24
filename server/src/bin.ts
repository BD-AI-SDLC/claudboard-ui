#!/usr/bin/env node
import { createServer } from 'node:net'
import { checkClaudeCodePrecondition } from './preconditions.js'
import { ensureBoschSdlcDir } from './first-boot.js'
import { createHttpServer } from './app.js'
import { attachWsServer } from './ws-server.js'
import { runBootstrap } from './bootstrap/state.js'
import open from 'open'

function isPortFree(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const srv = createServer()
    srv.once('error', () => resolve(false))
    srv.once('listening', () => { srv.close(); resolve(true) })
    srv.listen(port)
  })
}

async function pickPort(): Promise<number> {
  const envPort = process.env.BOSCH_SDLC_PORT
  if (envPort) {
    const port = Number(envPort)
    if (!(await isPortFree(port))) {
      console.error(`Port ${port} (BOSCH_SDLC_PORT) is already in use. Free the port or unset BOSCH_SDLC_PORT.`)
      process.exit(1)
    }
    return port
  }

  const DEFAULT_START = 3742
  for (let port = DEFAULT_START; port < DEFAULT_START + 100; port++) {
    if (await isPortFree(port)) return port
  }
  console.error('Could not find a free port in range 3742–3841.')
  process.exit(1)
}

checkClaudeCodePrecondition()
ensureBoschSdlcDir()

const port = await pickPort()
const { server } = createHttpServer()
attachWsServer(server)

server.listen(port, () => {
  const url = `http://localhost:${port}`
  console.log(`Listening on ${url}`)
  open(url)
})

// Kick off bootstrap (claudboard plugin check + silent install if missing) in
// the background. The HTTP server is already accepting connections; the UI
// polls /api/bootstrap/status and renders a setup card until state = 'ready'.
void runBootstrap()
