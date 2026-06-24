import type { Request, Response, NextFunction } from 'express'
import { getBootstrapStatus, getBootstrapMessageFor } from './state.js'

/**
 * Express middleware that returns 503 when bootstrap is not ready.
 *
 * Apply to mutating endpoints whose execution depends on the claudboard plugin
 * being installed (prereq runs) or on the CLI/SDK being functional (feature
 * runs). Read-only endpoints SHALL NOT be gated — viewing projects, runs, and
 * transcripts is available throughout install.
 */
export function bootstrapGuard(req: Request, res: Response, next: NextFunction): void {
  const status = getBootstrapStatus()
  if (status.state === 'ready') return next()
  const message = getBootstrapMessageFor(status.state)
  res.status(503).json({ error: message, bootstrapState: status.state })
}
