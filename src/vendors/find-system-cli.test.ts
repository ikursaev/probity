import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'

import { describe, it, expect } from 'vitest'

import { findSystemCli } from './find-system-cli.js'

describe('findSystemCli', () => {
  it('returns the first executable with that name on the search path', () => {
    const root = mkdtempSync(join(tmpdir(), 'probity-cli-'))
    const empty = dir(root, 'empty')
    const first = executable(dir(root, 'first'), 'claude')
    executable(dir(root, 'second'), 'claude')

    const found = findSystemCli('claude', {
      searchPath: [empty, join(root, 'first'), join(root, 'second')].join(
        delimiter,
      ),
      projectRoot: dir(root, 'project'),
    })

    expect(found).toBe(first)
  })

  it('skips a copy that lives in the project node_modules', () => {
    const root = mkdtempSync(join(tmpdir(), 'probity-cli-'))
    const project = dir(root, 'project')
    const bundled = dir(project, join('node_modules', '.bin'))
    executable(bundled, 'codex')
    const installed = executable(dir(root, 'bin'), 'codex')

    const found = findSystemCli('codex', {
      searchPath: [bundled, join(root, 'bin')].join(delimiter),
      projectRoot: project,
    })

    expect(found).toBe(installed)
  })

  it('throws, naming the CLI, when the search path has none', () => {
    const root = mkdtempSync(join(tmpdir(), 'probity-cli-'))

    const find = () =>
      findSystemCli('claude', {
        searchPath: dir(root, 'empty'),
        projectRoot: dir(root, 'project'),
      })

    expect(find).toThrow(/no system `claude` CLI on PATH/)
  })
})

function dir(root: string, name: string): string {
  const path = join(root, name)
  mkdirSync(path, { recursive: true })
  return path
}

function executable(directory: string, name: string): string {
  const path = join(directory, name)
  writeFileSync(path, '#!/bin/sh\n')
  chmodSync(path, 0o755)
  return path
}
