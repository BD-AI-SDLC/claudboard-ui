#!/usr/bin/env node
/**
 * CSS lint script.
 * 1. Checks that every top-level class selector contains at least one hyphen,
 *    enforcing a naming convention like `dash-card__title` or `run-banner__text`.
 * 2. Checks that no CSS file outside tokens.css contains hardcoded colour literals
 *    (#rgb, #rrggbb, rgb(...), rgba(...), hsl(...), hsla(...)).
 *
 * Fails with exit code 1 on any violation.
 */

import { readFileSync, readdirSync, statSync } from 'fs'
import { join, extname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const SRC_DIR = join(__dirname, '..', 'src')
const TOKENS_FILE = resolve(join(SRC_DIR, 'styles', 'tokens.css'))

/**
 * Recursively collect all .css files under a directory.
 * @param {string} dir
 * @returns {string[]}
 */
function collectCssFiles(dir) {
  /** @type {string[]} */
  const results = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      results.push(...collectCssFiles(full))
    } else if (extname(entry) === '.css') {
      results.push(full)
    }
  }
  return results
}

/**
 * Find top-level class selectors that have no hyphen in the class name.
 * @param {string} content
 * @returns {string[]} unprefixed class names
 */
function findUnprefixedClasses(content) {
  const unprefixed = []
  const lineRe = /^\.([a-zA-Z][a-zA-Z0-9_]*)(\s*\{|\s*,)/gm
  let match
  while ((match = lineRe.exec(content)) !== null) {
    const className = match[1]
    if (!className.includes('-')) {
      unprefixed.push(className)
    }
  }
  return unprefixed
}

/**
 * Strip block and line comments from CSS content, then find hardcoded colour literals.
 * @param {string} content
 * @returns {string[]} matched literals
 */
function findHardcodedColors(content) {
  const stripped = content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
  const colorRe = /(#[0-9a-fA-F]{3,8})\b|\brgba?\([^)]*\)|\bhsla?\([^)]*\)/g
  const matches = []
  let match
  while ((match = colorRe.exec(stripped)) !== null) {
    matches.push(match[0])
  }
  return matches
}

const cssFiles = collectCssFiles(SRC_DIR)
let hasErrors = false

for (const file of cssFiles) {
  const content = readFileSync(file, 'utf8')

  const unprefixed = findUnprefixedClasses(content)
  if (unprefixed.length > 0) {
    hasErrors = true
    for (const cls of unprefixed) {
      console.error(`[css-prefix] Unprefixed class ".${cls}" found in ${file}`)
    }
  }

  if (resolve(file) !== TOKENS_FILE) {
    const colors = findHardcodedColors(content)
    if (colors.length > 0) {
      hasErrors = true
      for (const literal of colors) {
        process.stderr.write(`[css-color] Hardcoded colour "${literal}" found in ${file}\n`)
      }
    }
  }
}

if (hasErrors) {
  console.error(
    '\nCSS lint failed. All top-level class selectors must contain a hyphen, and colour literals must live in tokens.css.',
  )
  console.error('Use a prefix like "dash-card__title" instead of "card", and use CSS custom properties for colours.\n')
  process.exit(1)
} else {
  console.info('CSS lint passed.')
}
