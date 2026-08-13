import { describe, expect, it } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import {
  buildReport, captureRequest, compareRequests, createInstructionSourceTracker,
} from '../src/core.ts'

function agentWith(input: {
  contextWindow?: number
  events?: unknown[]
  cwd?: string
} = {}): Agent {
  return {
    session: {
      events: input.events ?? [],
      header: { cwd: input.cwd ?? 'D:\\work\\project' },
      requestContext: () => input.contextWindow === undefined
        ? { provider: 'p', model: 'm' }
        : { provider: 'p', model: 'm', contextWindow: input.contextWindow },
    },
  } as unknown as Agent
}

function request(overrides: Partial<GenerateOptions> = {}): GenerateOptions {
  return {
    provider: 'provider-a',
    model: 'model-a',
    messages: [],
    system: 'TOP SECRET SYSTEM TEXT',
    tools: [{ name: 'read', description: 'SECRET DESCRIPTION', parameters: { secret: 'SECRET SCHEMA' } }],
    ...overrides,
  }
}

describe('field-level evidence', () => {
  it('labels public request fields and never retains sensitive request bodies', () => {
    const observation = captureRequest(agentWith({ contextWindow: 128_000 }), request(), 1, {
      systemTokens: 10,
      toolsTokens: 20,
      messageTokens: 30,
    })
    expect(observation.provider).toMatchObject({ status: 'Observed', value: 'provider-a' })
    expect(observation.contextWindow).toMatchObject({ status: 'Observed', value: 128_000 })
    expect(observation.contextBreakdown.systemTokens).toMatchObject({ status: 'Estimated', value: 10 })
    expect(observation.toolOwners.status).toBe('Unavailable')
    const serialized = JSON.stringify(observation)
    expect(serialized).not.toContain('TOP SECRET SYSTEM TEXT')
    expect(serialized).not.toContain('SECRET DESCRIPTION')
    expect(serialized).not.toContain('SECRET SCHEMA')
    expect(serialized).not.toMatch(/[0-9a-f]{64}/)
    expect(observation).not.toHaveProperty('systemSha256')
    expect(observation).not.toHaveProperty('toolCatalogSha256')
  })

  it('folds only durable AGENTS source metadata without reading content', () => {
    const events = [
      { type: 'user/message', data: { source: { kind: 'agent-instructions', changes: [
        { action: 'set', scope: '.', path: 'D:\\Users\\alice\\secret-project\\AGENTS.md', digest: 'secret-digest' },
        { action: 'set', scope: 'pkg', path: 'D:\\work\\project\\pkg\\AGENTS.md' },
      ] } } },
      { type: 'user/message', data: { source: { kind: 'agent-instructions', changes: [
        { action: 'remove', scope: '.', path: 'AGENTS.md' },
      ] } } },
    ]
    const withoutSystem = request()
    delete withoutSystem.system
    const observation = captureRequest(agentWith({ events }), withoutSystem, 1)
    expect(observation.agentsSources.value).toEqual(['workspace-nested'])
    expect(JSON.stringify(observation)).not.toContain('secret-digest')
    expect(JSON.stringify(observation)).not.toContain('alice')
    expect(JSON.stringify(observation)).not.toContain('secret-project')
  })

  it('incrementally folds 100k durable events within a bounded budget', () => {
    const events = Array.from({ length: 100_000 }, (_, index) => ({
      type: index === 99_999 ? 'user/message' : 'assistant/message',
      data: index === 99_999
        ? { source: { kind: 'agent-instructions', changes: [
          { action: 'set', scope: '.', path: 'D:\\work\\project\\AGENTS.md' },
        ] } }
        : {},
    }))
    const tracker = createInstructionSourceTracker()
    const agent = agentWith({ events })
    const started = performance.now()
    const first = captureRequest(agent, request(), 1, undefined, tracker)
    const firstMs = performance.now() - started
    expect(first.agentsSources.value).toEqual(['workspace-root'])
    expect(tracker.processedEvents).toBe(100_000)
    captureRequest(agent, request(), 2, undefined, tracker)
    expect(tracker.processedEvents).toBe(100_000)
    expect(tracker.scannedEvents).toBe(100_000)
    expect(firstMs).toBeLessThan(250)
  })

  it('compares two adjacent observations without claiming causality', () => {
    const first = captureRequest(agentWith(), request({ tools: [{ name: 'read', description: '', parameters: {} }] }), 1, {
      systemTokens: 10, toolsTokens: 5, messageTokens: 20,
    })
    const second = captureRequest(agentWith(), request({ provider: 'provider-b', tools: [{ name: 'write', description: '', parameters: {} }] }), 2, {
      systemTokens: 10, toolsTokens: 7, messageTokens: 25,
    })
    expect(compareRequests(first, second)).toEqual({
      available: true,
      providerChanged: true,
      modelChanged: false,
      systemPresenceChanged: false,
      systemChanged: false,
      toolCatalogChanged: true,
      addedTools: ['write'],
      removedTools: ['read'],
      addedAgentsSources: [],
      removedAgentsSources: [],
      estimatedTokenDelta: { systemTokens: 0, toolsTokens: 2, messageTokens: 5 },
    })
  })
})

describe('capability and version degradation', () => {
  it('labels missing fields and projection keys unavailable rather than zero', () => {
    const observation = captureRequest(agentWith(), request(), 1)
    expect(observation.contextWindow).toMatchObject({ status: 'Unavailable' })
    expect(observation.contextBreakdown.systemTokens).toMatchObject({ status: 'Unavailable' })
    const report = buildReport({ previous: null, current: observation })
    expect(report.tokens.systemTokens.value).toBeUndefined()
    expect(report.tokens.pressureTokens.value).toBeUndefined()
    expect(report.skills.entries.value).toBeUndefined()
    expect(report.plugins.entries.value).toBeUndefined()
  })

  it('preserves incomplete skill discovery as an observed partial result', () => {
    const report = buildReport({
      previous: null,
      current: null,
      skills: {
        complete: false,
        skills: [{
          name: 'review',
          description: 'sensitive routing copy',
          invocation: { modelInvocable: true, userInvocable: true },
          source: 'D:\\Users\\alice\\private-skills',
          provider: '@private/acme-skill-loader',
        }],
      },
    })
    expect(report.skills.complete).toMatchObject({ status: 'Observed', value: false })
    expect(report.skills.entries).toMatchObject({
      status: 'Observed',
      value: [{ name: 'review', sourceCategory: 'other', providerCategory: 'package' }],
    })
    expect(JSON.stringify(report)).not.toContain('alice')
    expect(JSON.stringify(report)).not.toContain('@private/acme-skill-loader')
    expect(JSON.stringify(report)).not.toContain('sensitive routing copy')
  })

  it('withholds sensitive discovery errors', () => {
    const report = buildReport({
      previous: null,
      current: null,
      skillsError: 'D:\\Users\\alice\\private-skills failed',
      pluginsError: 'file:///D:/Users/alice/secret-patch.yml failed',
    })
    expect(report.skills.entries.note).not.toContain('alice')
    expect(report.plugins.entries.note).not.toContain('alice')
    expect(JSON.stringify(report)).not.toContain('secret-patch')
  })

  it('minimizes plugin inventory fields and classifies sensitive module specifiers', () => {
    const report = buildReport({
      previous: null,
      current: null,
      plugins: [
        { entryId: 'patch:D:\\Users\\alice\\secret.yml#1', moduleName: 'file:///D:/Users/alice/private/plugin.js', enabled: true, fiberPhase: 'active' },
        { entryId: '@private/acme', moduleName: '@private/acme-plugin', enabled: false, fiberPhase: null },
      ] as never,
    })
    expect(report.plugins.entries.value).toEqual([
      { index: 0, moduleKind: 'file-url', enabled: true, fiberPhase: 'active' },
      { index: 1, moduleKind: 'package', enabled: false, fiberPhase: null },
    ])
    const serialized = JSON.stringify(report)
    expect(serialized).not.toContain('alice')
    expect(serialized).not.toContain('@private')
    expect(serialized).not.toContain('secret.yml')
  })

  it('keeps the explicit unavailable boundary list', () => {
    const report = buildReport({ previous: null, current: null })
    expect(report.unavailable.status).toBe('Unavailable')
    expect(report.unavailable.value).toContain('hidden policy and private system instructions')
    expect(report.unavailable.value).toContain('complete causal explanation of behavior differences')
  })
})
