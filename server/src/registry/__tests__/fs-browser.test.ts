/**
 * Unit tests for browseFsHandler in fs-browser.ts
 *
 * ESM-compatible: uses jest.unstable_mockModule() and dynamic imports.
 */

import { jest } from '@jest/globals'
import type { Dirent } from 'node:fs'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockRealpath = jest.fn<(...args: any[]) => Promise<string>>()
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockReaddir = jest.fn<(...args: any[]) => Promise<Dirent[]>>()
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockStat = jest.fn<(...args: any[]) => Promise<unknown>>()

jest.unstable_mockModule('node:fs/promises', () => ({
  realpath: mockRealpath,
  readdir: mockReaddir,
  stat: mockStat,
}))

jest.unstable_mockModule('node:os', () => ({
  homedir: () => '/home/test',
}))

const { browseFsHandler } = await import('../fs-browser.js')

// Helper to create mock req/res
function makeReqRes(query: Record<string, string> = {}) {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    headersSent: false,
  }
  const req = { query } as any // eslint-disable-line @typescript-eslint/no-explicit-any
  return { req, res: res as any } // eslint-disable-line @typescript-eslint/no-explicit-any
}

// Helper to create a mock dirent
function makeDirent(name: string, isDir = true): Dirent {
  return {
    name,
    isDirectory: () => isDir,
    isFile: () => !isDir,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    isSymbolicLink: () => false,
    parentPath: '',
    path: '',
  } as unknown as Dirent
}

describe('browseFsHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('happy path: valid absolute dir returns { path, parent, entries }', async () => {
    mockRealpath.mockResolvedValue('/home/test/projects')
    mockReaddir.mockResolvedValue([
      makeDirent('repo-a'),
      makeDirent('repo-b'),
      makeDirent('not-a-dir', false),
    ])
    mockStat.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))

    const { req, res } = makeReqRes({ path: '/home/test/projects' })
    await browseFsHandler(req, res)

    expect(res.status).not.toHaveBeenCalled()
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/home/test/projects',
        parent: '/home/test',
        entries: expect.arrayContaining([
          expect.objectContaining({ name: 'repo-a', isGitRepo: false }),
          expect.objectContaining({ name: 'repo-b', isGitRepo: false }),
        ]),
      }),
    )
    // non-directories should be filtered out
    const call = (res.json as jest.Mock).mock.calls[0]![0] as { entries: Array<{ name: string }> }
    expect(call.entries).toHaveLength(2)
  })

  it('missing path (no query) defaults to homedir and returns 200', async () => {
    mockRealpath.mockResolvedValue('/home/test')
    mockReaddir.mockResolvedValue([makeDirent('work')])
    mockStat.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))

    const { req, res } = makeReqRes({}) // no path param
    await browseFsHandler(req, res)

    // Should have called realpath with homedir
    expect(mockRealpath).toHaveBeenCalledWith('/home/test')
    expect(res.status).not.toHaveBeenCalled()
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/home/test' }),
    )
  })

  it('relative path returns 400', async () => {
    const { req, res } = makeReqRes({ path: 'relative/path' })
    await browseFsHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'path must be absolute' })
  })

  it('non-existent path returns 404', async () => {
    mockRealpath.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))

    const { req, res } = makeReqRes({ path: '/does/not/exist' })
    await browseFsHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith({ error: 'Path not found' })
  })

  it('unreadable dir (EACCES on readdir) returns 403', async () => {
    mockRealpath.mockResolvedValue('/restricted/dir')
    mockReaddir.mockRejectedValue(Object.assign(new Error('EACCES'), { code: 'EACCES' }))

    const { req, res } = makeReqRes({ path: '/restricted/dir' })
    await browseFsHandler(req, res)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({ error: 'Permission denied' })
  })

  it('git-repo detection: entry with .git → isGitRepo: true', async () => {
    mockRealpath.mockResolvedValue('/home/test/projects')
    mockReaddir.mockResolvedValue([makeDirent('my-git-repo'), makeDirent('plain-dir')])
    // First call (for my-git-repo/.git) succeeds, second (plain-dir/.git) fails
    mockStat
      .mockResolvedValueOnce({ isDirectory: () => true } as unknown as never) // my-git-repo/.git exists
      .mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) as unknown as never) // plain-dir/.git missing

    const { req, res } = makeReqRes({ path: '/home/test/projects' })
    await browseFsHandler(req, res)

    const call = (res.json as jest.Mock).mock.calls[0]![0] as { entries: Array<{ name: string; isGitRepo: boolean }> }
    const gitEntry = call.entries.find((e) => e.name === 'my-git-repo')
    const plainEntry = call.entries.find((e) => e.name === 'plain-dir')
    expect(gitEntry?.isGitRepo).toBe(true)
    expect(plainEntry?.isGitRepo).toBe(false)
  })

  it('500-entry cap: 600 entries → at most 500 returned', async () => {
    mockRealpath.mockResolvedValue('/home/test/big-dir')
    const manyDirs = Array.from({ length: 600 }, (_, i) => makeDirent(`dir-${i}`))
    mockReaddir.mockResolvedValue(manyDirs)
    mockStat.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))

    const { req, res } = makeReqRes({ path: '/home/test/big-dir' })
    await browseFsHandler(req, res)

    const call = (res.json as jest.Mock).mock.calls[0]![0] as { entries: unknown[] }
    expect(call.entries.length).toBeLessThanOrEqual(500)
    expect(call.entries).toHaveLength(500)
  })

  it('dotfiles are skipped unless inside a dotfile segment', async () => {
    mockRealpath.mockResolvedValue('/home/test/normal')
    mockReaddir.mockResolvedValue([
      makeDirent('.hidden'),
      makeDirent('visible'),
    ])
    mockStat.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))

    const { req, res } = makeReqRes({ path: '/home/test/normal' })
    await browseFsHandler(req, res)

    const call = (res.json as jest.Mock).mock.calls[0]![0] as { entries: Array<{ name: string }> }
    // .hidden should be excluded since path doesn't contain a dotfile segment
    expect(call.entries.map((e) => e.name)).toEqual(['visible'])
  })

  it('dotfiles are shown when resolved path itself is inside a dotfile segment', async () => {
    // .claude is a dotfile segment
    mockRealpath.mockResolvedValue('/home/test/.claude/skills')
    mockReaddir.mockResolvedValue([
      makeDirent('.hidden-inside-dot'),
      makeDirent('visible-inside-dot'),
    ])
    mockStat.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))

    const { req, res } = makeReqRes({ path: '/home/test/.claude/skills' })
    await browseFsHandler(req, res)

    const call = (res.json as jest.Mock).mock.calls[0]![0] as { entries: Array<{ name: string }> }
    expect(call.entries.map((e) => e.name)).toEqual(
      expect.arrayContaining(['.hidden-inside-dot', 'visible-inside-dot']),
    )
  })

  it('FS root returns parent: null', async () => {
    mockRealpath.mockResolvedValue('/')
    mockReaddir.mockResolvedValue([makeDirent('usr'), makeDirent('etc')])
    mockStat.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))

    const { req, res } = makeReqRes({ path: '/' })
    await browseFsHandler(req, res)

    const call = (res.json as jest.Mock).mock.calls[0]![0] as { parent: string | null }
    expect(call.parent).toBeNull()
  })
})
