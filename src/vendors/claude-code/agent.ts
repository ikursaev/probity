import type {
  EffortLevel,
  Options as ClaudeQueryOptions,
} from '@anthropic-ai/claude-agent-sdk'

import type { Agent } from '../../types.js'
import { type FindCli, resolveExecutable } from '../find-system-cli.js'
import { toVerdict } from '../to-verdict.js'

type ClaudeMessage = { type: string; [k: string]: unknown }

export type QueryFn = (args: {
  prompt: string
  options?: ClaudeQueryOptions
}) => AsyncIterable<ClaudeMessage>

/**
 * How the Claude Code validator runs. Every field is optional; with
 * none set the validator runs on the CLI the Agent SDK bundles, with
 * that CLI's default model.
 *
 * - `executable` — the `claude` CLI to run instead of the bundled
 *   one: a path, or `'system'` for the one installed on PATH (a copy
 *   in the project's `node_modules` does not count). A missing system
 *   CLI blocks the action rather than falling back to the bundled one.
 * - `model` — the model to ask, as the CLI's `--model` takes it (an
 *   alias such as `'opus'`, or a full model ID).
 * - `effort` — the effort level, as the CLI's `--effort` takes it.
 *   Left out, it is the CLI's default for the model.
 * - `promptCaching` — `false` runs the CLI with prompt caching off.
 *   The validator asks one question per run and its prompt differs
 *   every time, so a cache entry it writes is never read back, while
 *   writing it is billed above the plain input rate.
 */
export type ClaudeCodeOptions = {
  executable?: string
  model?: string
  effort?: EffortLevel
  promptCaching?: boolean
}

type ClaudeCodeDeps = {
  queryFn?: QueryFn
  findCli?: FindCli
  env?: Record<string, string | undefined>
}

export function claudeCode(
  deps: ClaudeCodeDeps & ClaudeCodeOptions = {},
): Agent {
  return {
    reason: (prompt) =>
      toVerdict(async () => {
        const queryFn = deps.queryFn ?? (await loadDefaultQueryFn())
        const executable = resolveExecutable('claude', deps)
        return getResult(queryFn, prompt, deps, executable)
      }),
  }
}

async function loadDefaultQueryFn(): Promise<QueryFn> {
  const mod = await import('@anthropic-ai/claude-agent-sdk')
  return mod.query
}

async function getResult(
  queryFn: QueryFn,
  prompt: string,
  options: ClaudeCodeDeps & ClaudeCodeOptions,
  executable: string | undefined,
): Promise<{ text: string; meta?: ClaudeCodeMeta }> {
  for await (const message of queryFn({
    prompt,
    options: {
      maxTurns: 1,
      thinking: { type: 'disabled' },
      permissionMode: 'dontAsk',
      tools: [],
      settings: { autoMemoryEnabled: false },
      settingSources: [],
      persistSession: false,
      ...(executable !== undefined && {
        pathToClaudeCodeExecutable: executable,
      }),
      ...(options.model !== undefined && { model: options.model }),
      ...(options.effort !== undefined && { effort: options.effort }),
      // The SDK replaces the CLI's environment with `env`, so the
      // caller's goes along: it carries the login the CLI runs on.
      ...(options.promptCaching === false && {
        env: {
          ...(options.env ?? process.env),
          DISABLE_PROMPT_CACHING: '1',
        },
      }),
    },
  })) {
    if (message.type === 'result' && message.subtype === 'success') {
      if (typeof message.result !== 'string') {
        throw new Error(
          `expected string result from validator, got ${typeof message.result}`,
        )
      }
      const meta = extractMeta(message)
      return meta ? { text: message.result, meta } : { text: message.result }
    }
  }
  throw new Error(
    'no result message received: SDK query stream ended without a ' +
      '{type:"result", subtype:"success"} message (typically an SDK/transport failure)',
  )
}

type ClaudeCodeMeta = {
  models: readonly ModelUsageRow[]
}

type ModelUsageRow = {
  model: string
  inputTokens?: number
  outputTokens?: number
  cacheReadInputTokens?: number
  cacheCreationInputTokens?: number
}

/**
 * modelUsage includes auxiliary harness calls (routing, classification)
 * alongside the verdict author, and nothing in it marks which is which,
 * so no single model is attributed.
 */
function extractMeta(message: ClaudeMessage): ClaudeCodeMeta | undefined {
  if (!isObject(message.modelUsage)) return undefined
  const models = Object.entries(message.modelUsage).map(([model, usage]) =>
    usageRow(model, usage),
  )
  return models.length > 0 ? { models } : undefined
}

function usageRow(model: string, usage: unknown): ModelUsageRow {
  if (!isObject(usage)) return { model }
  return {
    model,
    ...(typeof usage.inputTokens === 'number' && {
      inputTokens: usage.inputTokens,
    }),
    ...(typeof usage.outputTokens === 'number' && {
      outputTokens: usage.outputTokens,
    }),
    ...(typeof usage.cacheReadInputTokens === 'number' && {
      cacheReadInputTokens: usage.cacheReadInputTokens,
    }),
    ...(typeof usage.cacheCreationInputTokens === 'number' && {
      cacheCreationInputTokens: usage.cacheCreationInputTokens,
    }),
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}
