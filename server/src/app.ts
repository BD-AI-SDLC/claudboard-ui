import express, { type Request, type Response, type NextFunction } from 'express'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { projectRegistryRouter } from './registry/routes.js'
import { gateRouter } from './gate/routes.js'
import { runRouter } from './run/routes.js'
import { prereqRouter } from './prereq/routes.js'
import { bootstrapRouter } from './bootstrap/routes.js'
import { claudboardRouter } from './claudboard/routes.js'
import { getDb } from './db.js'
import { startCostTracker } from './cost/tracker.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

export function createApp() {
  const app = express()

  app.use(express.static(join(__dirname, 'public')))

  app.use(express.json())

  // structured logging middleware
  app.use((req: Request, _res: Response, next: NextFunction) => {
    console.info(`${req.method} ${req.path}`)
    next()
  })

  // health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' })
  })

  // API routes
  app.use('/api', bootstrapRouter)
  app.use('/api', projectRegistryRouter)
  app.use('/api', gateRouter)
  app.use('/api', runRouter)
  app.use('/api', prereqRouter)
  app.use('/api', claudboardRouter)

  // error middleware (must be last)
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Unhandled error:', err.message)
    res.status(500).json({ error: err.message })
  })

  return app
}

export function createHttpServer() {
  const app = createApp()
  const server = createServer(app)
  startCostTracker(getDb())
  return { app, server }
}
