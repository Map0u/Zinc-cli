import { existsSync } from 'node:fs'
import { basename, dirname, join, sep } from 'node:path'

export interface ProjectRootOptions {
  /** The user's home directory: it, and every ancestor of it, is never a project. */
  home: string
  /** Other directories that are never a project themselves (Desktop, Downloads, Documents, ...). */
  folders?: readonly string[]
  /** Overridable in tests. */
  now?: () => number
}

export interface ProjectRootResolver {
  /** The project a tab in `cwd` belongs to, or null when `cwd` is not a plausible project. */
  resolve(cwd: string | null): string | null
}

const CACHE_TTL_MS = 10_000
const CACHE_MAX_ENTRIES = 512

/**
 * Same folding as SessionStateService.groupCwdFor: separators unified, trailing
 * separators dropped (a drive root keeps its own), and case-insensitive on Windows.
 */
function normalize(path: string): string {
  const unified = process.platform === 'win32' ? path.replace(/\//g, '\\').toLowerCase() : path
  return /^([a-z]:\\|\\\\[^\\]+\\[^\\]+\\?|\/)$/.test(unified) ? unified : unified.replace(/[\\/]+$/, '')
}

/**
 * Resolves a tab's cwd to a stable project key: the enclosing git work tree
 * (`.git` may be a directory or, in worktrees and submodules, a file), else the
 * cwd itself. Both are subject to the stop boundaries: a drive root, the home
 * directory or its ancestors, and the well-known user folders are never
 * projects, and a repo rooted at one of them (a dotfiles repo in ~, or a stray
 * .git above) is ignored rather than swallowing everything below it.
 */
export function createProjectRootResolver(options: ProjectRootOptions): ProjectRootResolver {
  const now = options.now ?? Date.now
  const home = normalize(options.home)
  const folders = new Set((options.folders ?? []).map(normalize))
  // Per-directory repo lookup, short-lived so `git init` / deleting `.git` shows up without a restart.
  const repoCache = new Map<string, { at: number; root: string | null }>()
  // Equal paths that differ only in case must yield the same string, or two tabs in one project would not group.
  const spelling = new Map<string, string>()

  const isBoundary = (path: string): boolean => {
    const key = normalize(path)
    return dirname(path) === path || key === home || home.startsWith(key + sep) || folders.has(key)
  }

  const canonical = (path: string): string => {
    const key = normalize(path)
    const known = spelling.get(key)
    if (known) return known
    if (spelling.size >= CACHE_MAX_ENTRIES) spelling.clear()
    spelling.set(key, path)
    return path
  }

  const findRepo = (start: string): string | null => {
    const key = normalize(start)
    const cached = repoCache.get(key)
    if (cached && now() - cached.at < CACHE_TTL_MS) return cached.root
    let found: string | null = null
    for (let dir = start; ; dir = dirname(dir)) {
      if (existsSync(join(dir, '.git'))) {
        found = dir
        break
      }
      if (dirname(dir) === dir) break
    }
    if (repoCache.size >= CACHE_MAX_ENTRIES) repoCache.clear()
    repoCache.set(key, { at: now(), root: found })
    return found
  }

  return {
    resolve(cwd) {
      if (!cwd || isBoundary(cwd)) return null
      const repo = findRepo(cwd)
      return canonical(repo && !isBoundary(repo) ? repo : cwd)
    },
  }
}

export function projectNameOf(projectRoot: string | null): string | null {
  return projectRoot ? basename(projectRoot) || projectRoot : null
}
