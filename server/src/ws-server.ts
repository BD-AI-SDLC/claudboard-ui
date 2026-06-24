import { WebSocketServer, WebSocket } from 'ws'
import { type IncomingMessage } from 'node:http'
import { type Server } from 'node:http'
import type { WsEvent } from '@bosch-sdlc/protocol'
import { appendEvent } from './run/event-log.js'

// Room: keyed by run_id, holds connected clients and a recent event buffer
const rooms = new Map<string, { clients: Set<WebSocket>; buffer: WsEvent[] }>()
const BUFFER_SIZE = 200

type BroadcastHandler = (event: WsEvent) => void
const subscribers = new Set<BroadcastHandler>()

export function subscribe(handler: BroadcastHandler): () => void {
  subscribers.add(handler)
  return () => { subscribers.delete(handler) }
}

export function getOrCreateRoom(runId: string) {
  if (!rooms.has(runId)) {
    rooms.set(runId, { clients: new Set(), buffer: [] })
  }
  return rooms.get(runId)!
}

export function broadcast(runId: string, event: WsEvent) {
  appendEvent(runId, event)
  const room = getOrCreateRoom(runId)
  room.buffer.push(event)
  if (room.buffer.length > BUFFER_SIZE) {
    room.buffer.shift()
  }
  const payload = JSON.stringify(event)
  for (const client of room.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload)
    }
  }
  for (const handler of subscribers) {
    try { handler(event) } catch { /* subscriber errors never break broadcast */ }
  }
}

export function attachWsServer(server: Server) {
  const wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url ?? '', `http://${req.headers.host}`)
    const match = url.pathname.match(/^\/api\/runs\/([^/]+)\/stream$/)
    if (!match) {
      socket.destroy()
      return
    }
    const runId = match[1]!
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, runId)
    })
  })

  wss.on('connection', (ws: WebSocket, _req: IncomingMessage, runId: string) => {
    const room = getOrCreateRoom(runId)
    room.clients.add(ws)

    // replay buffer to the new client
    for (const event of room.buffer) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(event))
      }
    }

    ws.on('close', () => {
      room.clients.delete(ws)
    })
  })

  return wss
}
