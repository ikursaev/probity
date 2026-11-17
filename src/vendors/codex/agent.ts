import type { ModelReasoningEffort, ThreadOptions } from '@openai/codex-sdk'

import type { Agent } from '../../types.js'
import { type FindCli, resolveExecutable } from '../find-system-cli.js'
import { toVerdict } from '../to-verdict.js'

type CodexLike = {
  startThread(options?: ThreadOptions): {
    run(input: string): Promise<{
      finalResponse: string
      usage?: {
        input_tokens?: number
        output_tokens?: number
      } | null
    }>
  }
}

/**
 * How the Codex validator runs. With nothing set it runs on the CLI
 * the Codex SDK bundles.
 *
 * - `executable` — the `codex` CLI to run instead of the bundled one:
 *   a path, or `'system'` for the one installed on PATH (a copy in the
 *   project's `node_modules` does not count). A missing system CLI
 *   blocks the action rather than falling back to the bundled one.
 * - `model` — the model to ask, as `codex --model` takes it. Left out,
 *   it is the CLI's configured default.
 * - `reasoningEffort` — the reasoning effort, as the CLI's
 *   `model_reasoning_effort` setting takes it. Left out, it is
 *   `'high'`, whatever the user's Codex config sets for their own
 *   sessions.
 */
export type CodexOptions = {
  executable?: string
  model?: string
  reasoningEffort?: ModelReasoningEffort
}

type CodexDeps = {
  codex?: CodexLike
  findCli?: FindCli
  createCodex?: (options: { codexPathOverride?: string }) => CodexLike
}

export function codex(deps: CodexDeps & CodexOptions = {}): Agent {
  return {
    reason: (prompt) =>
      toVerdict(async () => {
        const instance = deps.codex ?? (await createInstance(deps))
        const thread = instance.startThread({
          skipGitRepoCheck: true,
          sandboxMode: 'read-only',
          approvalPolicy: 'never',
          networkAccessEnabled: false,
          webSearchEnabled: false,
          ...(deps.model === undefined ? {} : { model: deps.model }),
          modelReasoningEffort: deps.reasoningEffort ?? 'high',
        })
        const turn = await thread.run(prompt)
        const meta = buildMeta(turn.usage)
        return meta
          ? { text: turn.finalResponse, meta }
          : { text: turn.finalResponse }
      }),
  }
}

async function createInstance(
  deps: CodexDeps & CodexOptions,
): Promise<CodexLike> {
  const executable = resolveExecutable('codex', deps)
  const options =
    executable === undefined ? {} : { codexPathOverride: executable }
  if (deps.createCodex) return deps.createCodex(options)
  const mod = await import('@openai/codex-sdk')
  return new mod.Codex(options)
}

type CodexMeta = {
  inputTokens?: number
  outputTokens?: number
}

function buildMeta(
  usage: { input_tokens?: number; output_tokens?: number } | null | undefined,
): CodexMeta | undefined {
  const meta: CodexMeta = {}
  if (usage && typeof usage.input_tokens === 'number') {
    meta.inputTokens = usage.input_tokens
  }
  if (usage && typeof usage.output_tokens === 'number') {
    meta.outputTokens = usage.output_tokens
  }
  return Object.keys(meta).length > 0 ? meta : undefined
}
