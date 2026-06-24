import { join, dirname, isAbsolute, sep } from 'node:path'
import { realpath, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import type { Dirent } from 'node:fs'
import type { Request, Response } from 'express'

function isInsideDotfileSegment(resolved: string): boolean {
  return resolved.split(sep).some((seg) => seg.startsWith('.') && seg !== '.')
}

export async function browseFsHandler(req: Request, res: Response): Promise<void> {
  const rawPath = req.query['path'] as string | undefined

  // Default to homedir if not provided
  const p = rawPath && rawPath.trim() !== '' ? rawPath.trim() : homedir()

  // Must be absolute if explicitly provided
  if (rawPath && rawPath.trim() !== '' && !isAbsolute(p)) {
    res.status(400).json({ error: 'path must be absolute' })
    return
  }

  // Resolve symlinks
  let resolved: string
  try {
    resolved = await realpath(p)
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException
    if (e.code === 'ENOENT') {
      res.status(404).json({ error: 'Path not found' })
      return
    }
    if (e.code === 'EACCES') {
      res.status(403).json({ error: 'Permission denied' })
      return
    }
    res.status(500).json({ error: e.message })
    return
  }

  // Read directory
  let dirents: Dirent<string>[]
  try {
    dirents = await readdir(resolved, { withFileTypes: true, encoding: 'utf8' })
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException
    if (e.code === 'EACCES') {
      res.status(403).json({ error: 'Permission denied' })
      return
    }
    if (e.code === 'ENOENT') {
      res.status(404).json({ error: 'Path not found' })
      return
    }
    res.status(500).json({ error: e.message })
    return
  }

  // Filter to directories only, skip dotfiles unless inside a dotfile segment
  const showDotfiles = isInsideDotfileSegment(resolved)
  const filtered = dirents.filter((dirent) => {
    if (!dirent.isDirectory()) return false
    if (!showDotfiles && dirent.name.startsWith('.')) return false
    return true
  })

  // Hard cap at 500
  const capped = filtered.slice(0, 500)

  // Check for .git inside each entry
  const entries = await Promise.all(
    capped.map(async (dirent) => {
      const entryPath = join(resolved, dirent.name)
      const isGitRepo = await stat(join(entryPath, '.git'))
        .then(() => true)
        .catch(() => false)
      return { name: dirent.name, path: entryPath, isGitRepo }
    }),
  )

  // Compute parent (null at FS root)
  const parent = resolved === dirname(resolved) ? null : dirname(resolved)

  res.json({ path: resolved, parent, entries })
}
