import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { markAgentLoopRequest } from '@deepseek-ai/dsh-llm'
import { CordisInspectRegistryService } from '@deepseek-ai/dsh-cordis-host-runner'
import * as plugin from '../src/index.ts'

describe('observe-only lifecycle', () => {
  it('delegates the exact iterable once and unregisters the inspect provider on disposal', async () => {
    const root = new Context()
    await root.plugin(CordisInspectRegistryService)
    const agent = {
      session: {
        events: [],
        requestContext: () => ({ provider: 'p', model: 'm' }),
        header: {},
      },
    }
    const agents = { get: () => agent }
    root.provide('agents', agents)
    const mounted = root.extend()
    const fiber = mounted.plugin(plugin)
    await fiber
    expect(root.cordisInspect.list().some(entry => entry.id === 'ContextProvenance')).toBe(true)

    const iterable = (async function* () { yield { type: 'text', text: 'ok' } as never })()
    const next = vi.fn(() => iterable)
    const request = markAgentLoopRequest({
      provider: 'p', model: 'm', messages: [], sessionId: 'session-1' as never,
    })
    const listeners = [...root.events.dispatch('waterfall', [root, 'llm/stream', request, next])]
    expect(listeners).toHaveLength(1)
    const returned = listeners[0]?.(request, next)
    expect(returned).toBe(iterable)
    expect(next).toHaveBeenCalledTimes(1)

    await fiber.dispose()
    expect(root.cordisInspect.list().some(entry => entry.id === 'ContextProvenance')).toBe(false)
    expect([...root.events.dispatch('waterfall', [root, 'llm/stream', request, next])]).toHaveLength(0)
    await root.fiber.dispose()
  })

  it('can remount without duplicate provider state', async () => {
    const root = new Context()
    await root.plugin(CordisInspectRegistryService)
    const firstContext = root.extend()
    const first = firstContext.plugin(plugin)
    await first
    await first.dispose()
    const secondContext = root.extend()
    const second = secondContext.plugin(plugin)
    await second
    expect(root.cordisInspect.list().filter(entry => entry.id === 'ContextProvenance')).toHaveLength(1)
    await second.dispose()
    await root.fiber.dispose()
  })

  it('degrades when inspect is absent and ignores auxiliary loop requests', async () => {
    const root = new Context()
    const agent = {
      session: {
        events: [],
        requestContext: () => ({ provider: 'p', model: 'm' }),
        header: {},
      },
    }
    root.provide('agents', { get: () => agent })
    const fiber = root.plugin(plugin)
    await fiber

    const iterable = (async function* () {})()
    const next = vi.fn(() => iterable)
    const request = markAgentLoopRequest({
      provider: 'p', model: 'm', messages: [], purpose: 'compaction', sessionId: 'session-1' as never,
    })
    const listener = [...root.events.dispatch('waterfall', [root, 'llm/stream', request, next])][0]
    expect(listener?.(request, next)).toBe(iterable)
    expect(next).toHaveBeenCalledOnce()

    await fiber.dispose()
    await root.fiber.dispose()
  })
})
