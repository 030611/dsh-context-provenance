import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContextBreakdownProjection, ContextPressureProjection } from '@deepseek-ai/dsh-token-meter'
import type { SkillCatalogSnapshot } from '@deepseek-ai/dsh-skill'
import { createHmac, randomBytes } from 'node:crypto'
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
const FINGERPRINT_KEY = randomBytes(32)
const fingerprints = new WeakMap<RequestObservation, { system: string; tools: string }>()

export class InstructionSourceTracker {
  processedEvents = 0
  scannedEvents = 0
  readonly active = new Map<string, string>()
}

export function createInstructionSourceTracker(): InstructionSourceTracker {
  return new InstructionSourceTracker()
}

export function observed<T>(value: T, source: string, note?: string): EvidenceField<T> {
  return { status: 'Observed', value, source, ...(note === undefined ? {} : { note }) }
}

export function estimated<T>(value: T, source: string, note?: string): EvidenceField<T> {
  return { status: 'Estimated', value, source, ...(note === undefined ? {} : { note }) }
}

export function unavailable<T>(source: string, note: string): EvidenceField<T> {
  return { status: 'Unavailable', source, note }
}

function instructionSources(agent: Agent, tracker: InstructionSourceTracker): string[] {
  const events = agent.session.events
  if (events.length < tracker.processedEvents) {
    tracker.processedEvents = 0
    tracker.active.clear()
  }
  for (let index = tracker.processedEvents; index < events.length; index += 1) {
    const event = events[index]
    if (event === undefined) continue
    tracker.scannedEvents += 1
    if (event.type !== 'user/message') continue
    const source: unknown = event.data.source
    if (typeof source !== 'object' || source === null || !('kind' in source)
      || source.kind !== 'agent-instructions' || !('changes' in source) || !Array.isArray(source.changes)) continue
    for (const raw of source.changes) {
      if (typeof raw !== 'object' || raw === null || !('action' in raw)
        || !('scope' in raw) || !('path' in raw)
        || typeof raw.scope !== 'string' || typeof raw.path !== 'string') continue
      const scopeKey = privateFingerprint(raw.scope)
      if (raw.action === 'remove') tracker.active.delete(scopeKey)
      else if (raw.action === 'set' || raw.action === 'replace') {
        tracker.active.set(scopeKey, projectAgentsPath(raw.path, agent.session.header.cwd ?? ''))
      }
    }
  }
  tracker.processedEvents = events.length
  return [...new Set(tracker.active.values())].sort()
}

export function captureRequest(
  agent: Agent,
  request: GenerateOptions,
  ordinal: number,
  breakdown?: ContextBreakdownProjection,
  instructionTracker: InstructionSourceTracker = createInstructionSourceTracker(),
): RequestObservation {
  const context = agent.session.requestContext()
  const observation: RequestObservation = {
    ordinal,
    provider: observed(request.provider, REQUEST_SOURCE),
    model: observed(request.model, REQUEST_SOURCE),
    contextWindow: context?.contextWindow === undefined
      ? unavailable(CONTEXT_SOURCE, 'The adapter did not advertise a context window.')
      : observed(context.contextWindow, CONTEXT_SOURCE, 'Adapter-advertised capacity, not an independently verified hard limit.'),
    systemPresent: observed(request.system !== undefined && request.system.length > 0, REQUEST_SOURCE, 'Only presence is retained; text is never stored.'),
    toolNames: observed((request.tools ?? []).map(tool => tool.name), REQUEST_SOURCE, 'Descriptions and parameter schemas are never stored.'),
    toolOwners: unavailable('public ToolSchema', 'ToolSchema has no owner or plugin provenance field.'),
    agentsSources: observed(instructionSources(agent, instructionTracker), INSTRUCTION_SOURCE, 'Path categories from durable injections; raw paths, files on disk, and hidden instructions are not exposed.'),
    contextBreakdown: {
      systemTokens: estimatedBreakdown(breakdown, 'systemTokens'),
      toolsTokens: estimatedBreakdown(breakdown, 'toolsTokens'),
      messageTokens: estimatedBreakdown(breakdown, 'messageTokens'),
    },
  }
  fingerprints.set(observation, {
    system: privateFingerprint(request.system ?? ''),
    tools: privateFingerprint(JSON.stringify(request.tools ?? [])),
  })
  return observation
}

function privateFingerprint(value: string): string {
  return createHmac('sha256', FINGERPRINT_KEY).update(value).digest('hex')
}

function projectAgentsPath(path: string, cwd: string): string {
  const normalizedPath = path.replaceAll('\\', '/').replace(/\/+$/u, '')
  const normalizedCwd = cwd.replaceAll('\\', '/').replace(/\/+$/u, '')
  const caseFold = /^[A-Za-z]:\//u.test(normalizedPath)
  const candidate = caseFold ? normalizedPath.toLowerCase() : normalizedPath
  const workspace = caseFold ? normalizedCwd.toLowerCase() : normalizedCwd
  const absolute = /^(?:[A-Za-z]:\/|\/|file:)/u.test(normalizedPath)
  if (!absolute) return normalizedPath.includes('/') ? 'workspace-nested' : 'workspace-root'
  if (workspace.length > 0 && candidate.startsWith(`${workspace}/`)) {
    return candidate.slice(workspace.length + 1).includes('/') ? 'workspace-nested' : 'workspace-root'
  }
  return 'outside-workspace'
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
  const previousFingerprint = fingerprints.get(previous)
  const currentFingerprint = fingerprints.get(current)
  return {
    available: true,
    providerChanged: valueOf(previous.provider) !== valueOf(current.provider),
    modelChanged: valueOf(previous.model) !== valueOf(current.model),
    systemPresenceChanged: valueOf(previous.systemPresent) !== valueOf(current.systemPresent),
    ...(previousFingerprint === undefined || currentFingerprint === undefined ? {} : {
      systemChanged: previousFingerprint.system !== currentFingerprint.system,
      toolCatalogChanged: previousFingerprint.tools !== currentFingerprint.tools,
    }),
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
  pluginsError?: string
  plugins?: ReadonlyArray<{
    entryId: string
    moduleName: string
    enabled: boolean
    fiberPhase: 'pending' | 'loading' | 'active' | 'failed' | 'unloading' | null
  }>
}): ContextProvenanceReport {
  const skillNote = input.skillsError === undefined
    ? 'The skills service is not present in this composition.'
    : 'Skill discovery failed; provider details were withheld.'
  const pluginNote = input.pluginsError === undefined
    ? 'The official plugin inventory service is absent in this composition.'
    : 'Plugin inventory failed; provider details were withheld.'
  const skillEntries = input.skills?.skills.map(skill => ({
    name: skill.name,
    sourceCategory: skillSourceCategory(skill.source),
    providerCategory: skillProviderCategory(skill.provider),
  }))
  return {
    schemaVersion: 2,
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
        ? unavailable(PLUGIN_INVENTORY_SOURCE, pluginNote)
        : observed(input.plugins.map((entry, index) => ({
          index,
          moduleKind: moduleKind(entry.moduleName),
          enabled: entry.enabled,
          fiberPhase: entry.fiberPhase,
        })), PLUGIN_INVENTORY_SOURCE, 'Ordered point-in-time state with module syntax categories; entry ids and module specifiers are intentionally withheld.'),
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

function skillSourceCategory(source: string): NonNullable<ContextProvenanceReport['skills']['entries']['value']>[number]['sourceCategory'] {
  switch (source) {
    case 'project-dsh':
    case 'project-agents':
    case 'runtime':
    case 'user-dsh':
    case 'user-agents':
    case 'custom':
    case 'bundled': return source
    default: return 'other'
  }
}

function skillProviderCategory(provider: string): NonNullable<ContextProvenanceReport['skills']['entries']['value']>[number]['providerCategory'] {
  if (provider === 'runtime') return 'runtime'
  if (provider === 'filesystem' || provider.includes('skill-filesystem')) return 'filesystem'
  if (provider.startsWith('@') || provider.includes('/')) return 'package'
  return 'other'
}

function moduleKind(moduleName: string): NonNullable<ContextProvenanceReport['plugins']['entries']['value']>[number]['moduleKind'] {
  if (moduleName.startsWith('file:')) return 'file-url'
  if (/^(?:[A-Za-z]:[\\/]|\/)/u.test(moduleName)) return 'absolute-path'
  if (/^\.{1,2}[\\/]/u.test(moduleName)) return 'relative-path'
  if (/^(?:cordis|node):/u.test(moduleName)) return 'builtin'
  if (/^[a-z][a-z0-9+.-]*:/iu.test(moduleName)) return 'url'
  if (/^(?:@[a-z0-9._~-]+\/)?[a-z0-9._~-]+(?:\/.*)?$/iu.test(moduleName)) return 'package'
  return 'other'
}
