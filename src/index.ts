/** Observe-only context provenance over public DSH runtime interfaces. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { PluginInventorySnapshot } from '@deepseek-ai/dsh-host-plugin-inventory'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { isAgentLoopRequest } from '@deepseek-ai/dsh-llm'
import type { HostCordisInspectProviderRegistration } from '@deepseek-ai/dsh-cordis-host-runner'
import type { ContextBreakdownProjection, ContextPressureProjection } from '@deepseek-ai/dsh-token-meter'
import type { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import type { SkillRegistry } from '@deepseek-ai/dsh-skill'
import type { JsonValue } from '@deepseek-ai/dsh-session/types'
import { buildReport, captureRequest, createInstructionSourceTracker } from './core.ts'
import type { ContextProvenanceReport, RequestObservation } from './types.ts'

export type * from './types.ts'
export { buildReport, captureRequest, compareRequests, createInstructionSourceTracker } from './core.ts'

export const name = 'context-provenance'

const EMPTY_INPUT = { type: 'object', properties: {}, additionalProperties: false } as const
const OUTPUT: JsonValue = { description: 'Context provenance evidence report.' }

interface RequestPair {
  previous: RequestObservation | null
  current: RequestObservation | null
}

function shift(pair: RequestPair, observation: RequestObservation): void {
  pair.previous = pair.current
  pair.current = observation
}

function provider(ctx: Context, observations: WeakMap<Agent, RequestPair>): HostCordisInspectProviderRegistration {
  return {
    manifest: {
      id: 'ContextProvenance',
      description: 'Privacy-minimal evidence ledger for the requesting Agent. Every field is Observed, Estimated, or Unavailable.',
      methods: [{
        name: 'report',
        description: 'Compare the two most recent observed ordinary requests and report public token, skill, AGENTS, and provenance evidence without sensitive bodies.',
        inputSchema: EMPTY_INPUT,
        outputSchema: OUTPUT,
      }],
    },
    async query(method, _input, { agent, signal }) {
      if (method !== 'report') throw new Error(`unknown ContextProvenance method "${method}"`)
      signal.throwIfAborted()
      const pair = observations.get(agent) ?? { previous: null, current: null }
      const projections = ctx.get('sessionProjections', false) as SessionProjectionRegistry | undefined
      const values = projections?.snapshot(agent.session).values
      const breakdown = values?.contextBreakdown as ContextBreakdownProjection | undefined
      const pressure = values?.contextPressure as ContextPressureProjection | undefined
      const skills = ctx.get('skills', false) as SkillRegistry | undefined
      const pluginInventory = ctx.get('pluginInventory', false) as { list(): PluginInventorySnapshot } | undefined
      let skillSnapshot: Awaited<ReturnType<SkillRegistry['snapshot']>> | undefined
      let skillsError: string | undefined
      if (skills !== undefined) {
        try {
          skillSnapshot = await skills.snapshot({
            cwd: agent.session.header.cwd,
            signal,
            scope: agent,
          })
        } catch {
          skillsError = 'withheld'
        }
      }
      signal.throwIfAborted()
      let plugins: Array<{
        entryId: string
        moduleName: string
        enabled: boolean
        fiberPhase: 'pending' | 'loading' | 'active' | 'failed' | 'unloading' | null
      }> | undefined
      let pluginsError: string | undefined
      if (pluginInventory !== undefined) {
        try {
          plugins = pluginInventory.list().entries.map(entry => ({ ...entry, entryId: String(entry.entryId) }))
        } catch {
          pluginsError = 'withheld'
        }
      }
      const report = buildReport({
        previous: pair.previous,
        current: pair.current,
        ...(breakdown === undefined ? {} : { breakdown }),
        ...(pressure === undefined ? {} : { pressure }),
        ...(skillSnapshot === undefined ? {} : { skills: skillSnapshot }),
        ...(skillsError === undefined ? {} : { skillsError }),
        ...(pluginsError === undefined ? {} : { pluginsError }),
        ...(plugins === undefined ? {} : { plugins }),
      }) satisfies ContextProvenanceReport
      return report as unknown as JsonValue
    },
  }
}

/** Register the observer and its read-only inspect report. */
export function apply(ctx: Context): void {
  const observations = new WeakMap<Agent, RequestPair>()
  const instructionTrackers = new WeakMap<Agent, ReturnType<typeof createInstructionSourceTracker>>()
  ctx.inject(['cordisInspect'], (inspectCtx) => {
    inspectCtx.effect(
      () => inspectCtx.cordisInspect.register(provider(inspectCtx, observations)),
      'context-provenance: inspect provider',
    )
  })
  ctx.on('llm/stream', function (
    request: GenerateOptions,
    next: () => AsyncIterable<StreamChunk>,
  ): AsyncIterable<StreamChunk> {
    if (isAgentLoopRequest(request) && request.purpose === undefined && request.sessionId !== undefined) {
      try {
        const agents = ctx.get('agents', false) as { get(id: GenerateOptions['sessionId']): Agent | undefined } | undefined
        const agent = agents?.get(request.sessionId)
        if (agent !== undefined) {
          const pair = observations.get(agent) ?? { previous: null, current: null }
          const instructionTracker = instructionTrackers.get(agent) ?? createInstructionSourceTracker()
          const projections = ctx.get('sessionProjections', false) as SessionProjectionRegistry | undefined
          const breakdown = projections?.snapshot(agent.session).values.contextBreakdown as ContextBreakdownProjection | undefined
          shift(pair, captureRequest(agent, request, (pair.current?.ordinal ?? 0) + 1, breakdown, instructionTracker))
          observations.set(agent, pair)
          instructionTrackers.set(agent, instructionTracker)
        }
      } catch (error) {
        ctx.logger.warn(`context-provenance observation skipped: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return next()
  })
}
