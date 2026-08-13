import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContextBreakdownProjection, ContextPressureProjection } from '@deepseek-ai/dsh-token-meter'
import type { SkillCatalogSnapshot } from '@deepseek-ai/dsh-skill'
import { createHash } from 'node:crypto'
import type {
  ContextProvenanceReport, EvidenceField, RequestComparison, RequestObservation,
} from './types.ts'

const REQUEST_SOURCE = '@deepseek-ai/dsh-llm GenerateOptions at llm/stream'
const CONTEXT_SOURCE = '@deepseek-ai/dsh-session request/context'
const INSTRUCTION_SOURCE = '@deepseek-ai/dsh-session user/message.source(agent-instructions)'
const BREAKDOWN_SOURCE = '@deepseek-ai/dsh-token-meter contextBreakdown projection'
const PRESSURE_SOURCE = '@deepseek-ai/dsh-token-meter contextPressure projection'
const SKILL_SOURCE = '@deepseek-ai/dsh-skill SkillRegistry.snapshot'
const PLUGIN_INVENTORY_SOURCE = '@deepseek-ai/dsh-host-plugin-inventory pluginInventory/list'

export function observed<T>(value: T, source: string, note?: string): EvidenceField<T> {
  return { status: 'Observed', value, source, ...(note === undefined ? {} : { note }) }
}

export function estimated<T>(value: T, source: string, note?: string): EvidenceField<T> {
  return { status: 'Estimated', value, source, ...(note === undefined ? {} : { note }) }
}

export function unavailable<T>(source: string, note: string): EvidenceField<T> {
  return { status: 'Unavailable', source, note }
}

function instructionSources(agent: Agent): string[] {
  const active = new Map<string, string>()
  for (const event of agent.session.events) {
    if (event.type !== 'user/message') continue
    const source: unknown = event.data.source
    if (typeof source !== 'object' || source === null || !('kind' in source)
      || source.kind !== 'agent-instructions' || !('changes' in source) || !Array.isArray(source.changes)) continue
    for (const raw of source.changes) {
      if (typeof raw !== 'object' || raw === null || !('action' in raw)
        || !('scope' in raw) || !('path' in raw)
        || typeof raw.scope !== 'string' || typeof raw.path !== 'string') continue
      if (raw.action === 'remove') active.delete(raw.scope)
      else if (raw.action === 'set' || raw.action === 'replace') active.set(raw.scope, raw.path)
    }
  }
  return [...new Set(active.values())].sort()
}

export function captureRequest(
  agent: Agent,
  request: GenerateOptions,
  ordinal: number,
  breakdown?: ContextBreakdownProjection,
): RequestObservation {
  const context = agent.session.requestContext()
  return {
    ordinal,
    provider: observed(request.provider, REQUEST_SOURCE),
    model: observed(request.model, REQUEST_SOURCE),
    contextWindow: context?.contextWindow === undefined
      ? unavailable(CONTEXT_SOURCE, 'The adapter did not advertise a context window.')
      : observed(context.contextWindow, CONTEXT_SOURCE, 'Adapter-advertised capacity, not an independently verified hard limit.'),
    systemPresent: observed(request.system !== undefined && request.system.length > 0, REQUEST_SOURCE, 'Only presence is retained; text is never stored.'),
    systemSha256: observed(sha256(request.system ?? ''), REQUEST_SOURCE, 'One-way equality fingerprint; prompt text is never retained.'),
    toolNames: observed((request.tools ?? []).map(tool => tool.name), REQUEST_SOURCE, 'Descriptions and parameter schemas are never stored.'),
    toolCatalogSha256: observed(sha256(JSON.stringify(request.tools ?? [])), REQUEST_SOURCE, 'One-way equality fingerprint; schema bodies are never retained.'),
    toolOwners: unavailable('public ToolSchema', 'ToolSchema has no owner or plugin provenance field.'),
    agentsSources: observed(instructionSources(agent), INSTRUCTION_SOURCE, 'Paths recorded by durable injections; not all files on disk or hidden instructions.'),
    contextBreakdown: {
      systemTokens: estimatedBreakdown(breakdown, 'systemTokens'),
      toolsTokens: estimatedBreakdown(breakdown, 'toolsTokens'),
      messageTokens: estimatedBreakdown(breakdown, 'messageTokens'),
    },
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function valueOf<T>(field: EvidenceField<T>): T | undefined {
  return field.status === 'Unavailable' ? undefined : field.value
}

function setDifference(left: readonly string[], right: readonly string[]): string[] {
  const other = new Set(right)
  return left.filter(value => !other.has(value))
}

export function compareRequests(
  previous: RequestObservation | null,
  current: RequestObservation | null,
): RequestComparison {
  if (previous === null || current === null) return { available: false }
  const previousTools = valueOf(previous.toolNames) ?? []
  const currentTools = valueOf(current.toolNames) ?? []
  const previousAgents = valueOf(previous.agentsSources) ?? []
  const currentAgents = valueOf(current.agentsSources) ?? []
  const delta = tokenDelta(previous, current)
  return {
    available: true,
    providerChanged: valueOf(previous.provider) !== valueOf(current.provider),
    modelChanged: valueOf(previous.model) !== valueOf(current.model),
    systemPresenceChanged: valueOf(previous.systemPresent) !== valueOf(current.systemPresent),
    systemChanged: valueOf(previous.systemSha256) !== valueOf(current.systemSha256),
    toolCatalogChanged: valueOf(previous.toolCatalogSha256) !== valueOf(current.toolCatalogSha256),
    addedTools: setDifference(currentTools, previousTools),
    removedTools: setDifference(previousTools, currentTools),
    addedAgentsSources: setDifference(currentAgents, previousAgents),
    removedAgentsSources: setDifference(previousAgents, currentAgents),
    ...(delta === undefined ? {} : { estimatedTokenDelta: delta }),
  }
}

function tokenDelta(previous: RequestObservation, current: RequestObservation): RequestComparison['estimatedTokenDelta'] {
  const previousSystem = valueOf(previous.contextBreakdown.systemTokens)
  const previousTools = valueOf(previous.contextBreakdown.toolsTokens)
  const previousMessages = valueOf(previous.contextBreakdown.messageTokens)
  const currentSystem = valueOf(current.contextBreakdown.systemTokens)
  const currentTools = valueOf(current.contextBreakdown.toolsTokens)
  const currentMessages = valueOf(current.contextBreakdown.messageTokens)
  if (previousSystem === undefined || previousTools === undefined || previousMessages === undefined
    || currentSystem === undefined || currentTools === undefined || currentMessages === undefined) return undefined
  return {
    systemTokens: currentSystem - previousSystem,
    toolsTokens: currentTools - previousTools,
    messageTokens: currentMessages - previousMessages,
  }
}

function estimatedBreakdown(
  projection: ContextBreakdownProjection | undefined,
  key: keyof ContextBreakdownProjection,
): EvidenceField<number> {
  return projection === undefined
    ? unavailable(BREAKDOWN_SOURCE, 'The contextBreakdown projection is not registered in this composition.')
    : estimated(projection[key], BREAKDOWN_SOURCE, 'Official fixed heuristic; not provider tokenization or billing.')
}

function pressureField(
  projection: ContextPressureProjection | undefined,
  key: 'pressureTokens' | 'projectedTokens',
): EvidenceField<number> {
  const value = projection?.[key]
  if (value === undefined) return unavailable(PRESSURE_SOURCE, 'No provider usage anchor is available yet.')
  return key === 'pressureTokens'
    ? observed(value, PRESSURE_SOURCE, 'Derived from provider-reported input and cache usage buckets.')
    : estimated(value, PRESSURE_SOURCE, 'Provider usage anchor plus an official heuristic surface delta.')
}

export function buildReport(input: {
  previous: RequestObservation | null
  current: RequestObservation | null
  breakdown?: ContextBreakdownProjection
  pressure?: ContextPressureProjection
  skills?: SkillCatalogSnapshot
  skillsError?: string
  plugins?: ContextProvenanceReport['plugins']['entries']['value']
}): ContextProvenanceReport {
  const skillNote = input.skillsError ?? 'The skills service is not present in this composition.'
  const skillEntries = input.skills?.skills.map(skill => ({
    name: skill.name,
    source: skill.source,
    provider: skill.provider,
  }))
  return {
    schemaVersion: 1,
    scope: 'requesting-agent',
    requests: {
      current: input.current,
      previous: input.previous,
      comparison: compareRequests(input.previous, input.current),
    },
    tokens: {
      systemTokens: estimatedBreakdown(input.breakdown, 'systemTokens'),
      toolsTokens: estimatedBreakdown(input.breakdown, 'toolsTokens'),
      messageTokens: estimatedBreakdown(input.breakdown, 'messageTokens'),
      pressureTokens: pressureField(input.pressure, 'pressureTokens'),
      projectedTokens: pressureField(input.pressure, 'projectedTokens'),
    },
    skills: {
      complete: input.skills === undefined
        ? unavailable(SKILL_SOURCE, skillNote)
        : observed(input.skills.complete, SKILL_SOURCE, input.skills.complete ? undefined : 'Provider discovery was incomplete; absence is not authoritative.'),
      entries: skillEntries === undefined
        ? unavailable(SKILL_SOURCE, skillNote)
        : observed(skillEntries, SKILL_SOURCE, input.skills?.complete === false ? 'Partial current observation.' : undefined),
    },
    plugins: {
      entries: input.plugins === undefined
        ? unavailable(PLUGIN_INVENTORY_SOURCE, 'The official plugin inventory service is absent in this composition.')
        : observed(input.plugins, PLUGIN_INVENTORY_SOURCE, 'Point-in-time Loader entries only; not contribution or configuration provenance.'),
      contributionMapping: unavailable('pluginInventory/list and public schemas', 'No public interface maps a Loader entry to request tools, skills, prompts, or AGENTS sources.'),
    },
    unavailable: {
      status: 'Unavailable',
      source: 'public DeepSeek Harness interfaces',
      note: 'No public interface exposes these fields.',
      value: [
        'hidden policy and private system instructions',
        'tools hidden from the requesting agent',
        'tool-to-plugin ownership',
        'plugin bundle/profile/override provenance',
        'complete causal explanation of behavior differences',
      ],
    },
  }
}
