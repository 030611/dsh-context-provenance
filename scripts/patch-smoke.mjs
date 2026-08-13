import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
if (manifest.dsh?.bundle?.patch !== './cordis.patch.yml') throw new Error('package manifest does not select cordis.patch.yml')
if (!patch.includes('name: dsh-context-provenance')) throw new Error('bundle patch does not load the package by name')
const require = createRequire(import.meta.url)
for (const [name, expected] of Object.entries(manifest.peerDependencies)) {
  const actual = require(`${name}/package.json`).version
  const accepted = expected.split('||').map(value => value.trim())
  if (!accepted.includes(actual)) throw new Error(`${name}: peer ${expected} does not include installed ${actual}`)
}
