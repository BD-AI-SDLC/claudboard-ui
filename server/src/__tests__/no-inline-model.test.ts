/**
 * Asserts that no production source file in server/src/ contains hard-coded
 * Anthropic model ID strings. All model references must go through MODELS from
 * @bosch-sdlc/protocol.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const serverSrc = join(__dirname, '..')

function collectSourceFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue
      files.push(...collectSourceFiles(full))
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      files.push(full)
    }
  }
  return files
}

const MODEL_LITERAL = /claude-(opus|sonnet|haiku)/

describe('no inline model strings in production source', () => {
  const sourceFiles = collectSourceFiles(serverSrc)

  it('finds at least some source files to check', () => {
    expect(sourceFiles.length).toBeGreaterThan(0)
  })

  for (const file of sourceFiles) {
    const rel = relative(serverSrc, file)
    it(`${rel} contains no hard-coded model literals`, () => {
      const content = readFileSync(file, 'utf8')
      const lines = content.split('\n')
      const violations = lines
        .map((line, i) => ({ line, num: i + 1 }))
        .filter(({ line }) => MODEL_LITERAL.test(line))
      expect(violations).toEqual([])
    })
  }
})
