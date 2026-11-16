import { accessSync, constants, realpathSync, statSync } from 'node:fs'
import { delimiter, isAbsolute, join, resolve, sep } from 'node:path'

/**
 * Locates a vendor CLI the user installed themselves, by walking the
 * search path the way a shell would. Validators use it to run on the
 * installed CLI rather than the copy an SDK bundles, which lags behind
 * and can lack the models and fixes of the installed one.
 *
 * A copy under the project's own `node_modules` is the bundled one
 * (package managers put `node_modules/.bin` on the path of the scripts
 * they run), so it is skipped; links are resolved first, because
 * `.bin` entries are links into the package.
 */
export function findSystemCli(
  name: string,
  options: { searchPath: string | undefined; projectRoot: string },
): string {
  const bundled = realPath(join(options.projectRoot, 'node_modules'))
  for (const directory of (options.searchPath ?? '').split(delimiter)) {
    if (!isAbsolute(directory)) continue
    const candidate = resolve(directory, name)
    if (!isExecutableFile(candidate)) continue
    const target = realPath(candidate)
    if (target === bundled || target.startsWith(bundled + sep)) continue
    return candidate
  }
  throw new Error(
    `no system \`${name}\` CLI on PATH outside the project's node_modules: ` +
      'install it, or drop the `executable` option to use the bundled one',
  )
}

export type FindCli = (name: string) => string

/**
 * Turns a validator's `executable` option into the path to run:
 * `undefined` keeps the SDK's bundled CLI, `'system'` is the installed
 * one, anything else is a path taken as given.
 */
export function resolveExecutable(
  name: string,
  options: { executable?: string | undefined; findCli?: FindCli | undefined },
): string | undefined {
  if (options.executable !== 'system') return options.executable
  const find = options.findCli ?? findOnProcessPath
  return find(name)
}

function findOnProcessPath(name: string): string {
  return findSystemCli(name, {
    searchPath: process.env.PATH,
    projectRoot: process.cwd(),
  })
}

function realPath(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

function isExecutableFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}
