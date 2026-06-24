import { realpath } from 'node:fs/promises'
import { isAbsolute, resolve, sep } from 'node:path'

export class WorkspaceBoundaryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkspaceBoundaryError'
  }
}

/**
 * Resolve `relPath` against `workspaceRoot` and assert the resolved real path
 * is strictly inside the real path of `workspaceRoot`. Follows symlinks on both
 * sides. Throws WorkspaceBoundaryError if the resolved path escapes the
 * workspace, or if either side cannot be realpath'd.
 *
 * Returns the absolute, realpath-resolved path.
 */
export async function resolveUnderWorkspace(
  workspaceRoot: string,
  relPath: string,
): Promise<string> {
  let rootReal: string
  try {
    rootReal = await realpath(workspaceRoot)
  } catch (err) {
    throw new WorkspaceBoundaryError(
      `workspaceRoot not accessible: ${workspaceRoot} (${(err as Error).message})`,
    )
  }

  const joined = isAbsolute(relPath) ? relPath : resolve(rootReal, relPath)

  let targetReal: string
  try {
    targetReal = await realpath(joined)
  } catch (err) {
    throw new WorkspaceBoundaryError(
      `path not accessible: ${relPath} under ${workspaceRoot} (${(err as Error).message})`,
    )
  }

  const rootWithSep = rootReal.endsWith(sep) ? rootReal : rootReal + sep
  if (targetReal !== rootReal && !targetReal.startsWith(rootWithSep)) {
    throw new WorkspaceBoundaryError(
      `path escapes workspaceRoot: ${relPath} → ${targetReal} (root: ${rootReal})`,
    )
  }

  return targetReal
}
