import { Router } from 'express'
import { getBootstrapStatus, retryBootstrap } from './state.js'

const router = Router()

router.get('/bootstrap/status', (_req, res) => {
  res.json(getBootstrapStatus())
})

router.post('/bootstrap/retry', async (_req, res) => {
  const result = retryBootstrap()
  if (result === null) {
    return void res.status(409).json({
      error: 'Bootstrap retry is only valid from install-failed state.',
      currentState: getBootstrapStatus().state,
    })
  }
  const status = await result
  res.json(status)
})

export { router as bootstrapRouter }
