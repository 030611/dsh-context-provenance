import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { CordisInspectRegistryService } from '@deepseek-ai/dsh-cordis-host-runner'
import * as Provenance from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('real Loader composition', () => {
  it('mounts the report and withdraws it when the Loader entry is disabled', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-context-provenance-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- id: inspect",
      "  name: 'fixture-inspect'",
      "- id: context-provenance",
      "  name: 'dsh-context-provenance'",
      '',
    ].join('\n'))

    const ctx = new Context()
    context = ctx
    ctx.baseUrl = pathToFileURL(root).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['fixture-inspect', CordisInspectRegistryService],
      ['dsh-context-provenance', Provenance],
    ])
    ctx.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof ctx.loader.internal>
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await ctx.loader.await()

    expect(ctx.cordisInspect.list().some(entry => entry.id === 'ContextProvenance')).toBe(true)
    const entry = [...ctx.loader.entries()].find(candidate => candidate.options.name === 'dsh-context-provenance')
    expect(entry).toBeDefined()
    if (entry === undefined) return
    await ctx.loader.update(entry.id, { disabled: true })
    await ctx.loader.await()
    expect(ctx.cordisInspect.list().some(candidate => candidate.id === 'ContextProvenance')).toBe(false)
  })
})
