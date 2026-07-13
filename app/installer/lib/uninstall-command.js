const path = require('node:path')

const SHELL_META = /[\u0000-\u001f&|<>^%!]/

/**
 * Parse the restricted subset of the Windows command-line grammar accepted for
 * registry uninstall commands. The result is passed directly to execFile; no
 * command processor, environment expansion, or shell interpretation is used.
 */
function parseUninstallCommand(command) {
  if (typeof command !== 'string' || !command.trim()) {
    throw new Error('Zinc uninstall command was not found.')
  }
  if (SHELL_META.test(command)) {
    throw new Error('Zinc uninstall command contains unsupported shell syntax.')
  }

  const tokens = splitWindowsCommandLine(command.trim())
  if (tokens.length === 0) {
    throw new Error('Zinc uninstall command was not found.')
  }

  const executable = tokens[0]
  if (
    !path.win32.isAbsolute(executable) ||
    !/^[A-Za-z]:\\/.test(executable) ||
    /(?:^|\\)\.{1,2}(?:\\|$)/.test(executable) ||
    path.win32.extname(executable).toLowerCase() !== '.exe'
  ) {
    throw new Error('Zinc uninstall command executable is invalid.')
  }

  return { executable, args: tokens.slice(1) }
}

function splitWindowsCommandLine(command) {
  const args = []
  let index = 0

  while (index < command.length) {
    while (index < command.length && /\s/.test(command[index])) index += 1
    if (index >= command.length) break

    let token = ''
    let inQuotes = false
    while (index < command.length) {
      if (!inQuotes && /\s/.test(command[index])) break

      let backslashes = 0
      while (command[index] === '\\') {
        backslashes += 1
        index += 1
      }

      if (command[index] === '"') {
        token += '\\'.repeat(Math.floor(backslashes / 2))
        if (backslashes % 2 === 0) {
          inQuotes = !inQuotes
        } else {
          token += '"'
        }
        index += 1
        continue
      }

      token += '\\'.repeat(backslashes)
      if (index < command.length) {
        token += command[index]
        index += 1
      }
    }

    if (inQuotes) {
      throw new Error('Zinc uninstall command contains an unterminated quote.')
    }
    if (!token) {
      throw new Error('Zinc uninstall command contains an empty executable or argument.')
    }
    args.push(token)
  }

  return args
}

module.exports = { parseUninstallCommand, splitWindowsCommandLine }
