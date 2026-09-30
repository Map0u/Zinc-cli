// Dependency-free AI CLI identifiers shared by session restore and process
// detection. Kept free of electron/node/koffi so unit tests can load it without
// native bindings.

export type AiCliTool = 'codex' | 'claude' | 'grok' | 'kimi'

// Stable priority only for otherwise indistinguishable process matches.
export const AI_CLI_TOOLS: readonly AiCliTool[] = ['codex', 'claude', 'grok', 'kimi']

function argumentsOf(commandLine: string): string[] {
  // A quoted Windows executable path (or a shell -c argument) is one token.
  // Only invocation positions are examined below; quoted prompts are not CLIs.
  const args: string[] = []
  const pattern = /"([^"]*)"|'([^']*)'|([^\s"']+)/g
  for (const match of commandLine.matchAll(pattern)) args.push(match[1] ?? match[2] ?? match[3])
  return args
}

function imageName(path: string): string {
  return path.split(/[\\/]/).at(-1)?.toLowerCase() ?? ''
}

function executableTool(path: string): AiCliTool | null {
  const image = imageName(path)
  for (const tool of AI_CLI_TOOLS) {
    const name = tool === 'claude' ? 'claude(?:-code)?' : tool
    if (new RegExp(`^${name}(?:\\.(?:exe|cmd|ps1|js|mjs|cjs))?$`).test(image)) return tool
  }
  return null
}

function entrypointTool(path: string): AiCliTool | null {
  const direct = executableTool(path)
  if (direct) return direct
  // Node-based CLIs often run a generic cli.js inside their own package.
  const packageName = path.toLowerCase().replace(/\\/g, '/')
  if (/(?:^|\/)@anthropic-ai\/claude-code\/(?:[^\s]+\/)*cli\.(?:c?js|mjs)$/.test(packageName)) return 'claude'
  if (/(?:^|\/)@openai\/codex\/(?:[^\s]+\/)*cli\.(?:c?js|mjs)$/.test(packageName)) return 'codex'
  if (/(?:^|\/)@moonshot-ai\/kimi-code\/(?:[^\s]+\/)*cli\.(?:c?js|mjs)$/.test(packageName)) return 'kimi'
  if (/(?:^|\/)(?:@anthropic-ai\/)?claude-code\/bin\/claude\.js$/.test(packageName)) return 'claude'
  return null
}

/** Identify an executable or a wrapper's explicit entrypoint, never arbitrary arguments. */
export function identifyToolFromCommandLine(commandLine: string): AiCliTool | null {
  function invocation(args: string[], depth: number): AiCliTool | null {
    if (depth > 3 || args.length === 0) return null
    const executable = imageName(args[0])
    const direct = executableTool(args[0])
    if (direct) return direct

    if (/^(?:node|nodejs|bun|deno)(?:\.exe)?$/.test(executable)) {
      for (let i = 1; i < args.length; i++) {
        const arg = args[i]
        if (/^(?:-e|--eval|-p|--print)$/.test(arg) || /^(?:-e|-p)=?/.test(arg)) return null
        if (/^(?:-r|--require|--loader|--import)$/.test(arg)) { i++; continue }
        if (arg.startsWith('-')) continue
        return entrypointTool(arg)
      }
    }

    // npm/PowerShell shims keep the entrypoint inside the wrapper command.
    if (/^(?:npx|bunx|npm)(?:\.(?:exe|cmd|ps1))?$/.test(executable)) {
      const entry = args.slice(1).find((arg) => !arg.startsWith('-'))
      if (!entry) return null
      if (entry.toLowerCase() === '@anthropic-ai/claude-code') return 'claude'
      if (entry.toLowerCase() === '@openai/codex') return 'codex'
      if (entry.toLowerCase() === '@moonshot-ai/kimi-code') return 'kimi'
      return executableTool(entry)
    }

    if (/^(?:cmd)(?:\.exe)?$/.test(executable)) {
      const command = args.findIndex((arg, i) => i > 0 && /^\/(?:c|k)$/i.test(arg))
      if (command >= 0) return invocation(argumentsOf(args.slice(command + 1).join(' ')), depth + 1)
    }
    if (/^(?:pwsh|powershell)(?:\.exe)?$/.test(executable)) {
      const file = args.findIndex((arg, i) => i > 0 && /^(?:-file|-f)$/i.test(arg))
      if (file >= 0) return entrypointTool(args[file + 1] ?? '')
      const command = args.findIndex((arg, i) => i > 0 && /^(?:-command|-c)$/i.test(arg))
      if (command >= 0) return invocation(argumentsOf(args.slice(command + 1).join(' ')), depth + 1)
    }
    if (/^(?:sh|bash|zsh|fish)(?:\.exe)?$/.test(executable)) {
      const command = args.findIndex((arg, i) => i > 0 && /^-.*c$/.test(arg))
      if (command >= 0) return invocation(argumentsOf(args.slice(command + 1).join(' ')), depth + 1)
    }
    if (/^wsl(?:\.exe)?$/.test(executable)) {
      let i = 1
      while (i < args.length) {
        if (args[i] === '--') { i++; break }
        if (/^(?:-d|--distribution|-u|--user|--cd)$/.test(args[i])) { i += 2; continue }
        if (args[i].startsWith('-')) { i++; continue }
        break
      }
      return invocation(args.slice(i), depth + 1)
    }
    return null
  }
  return invocation(argumentsOf(commandLine), 0)
}
