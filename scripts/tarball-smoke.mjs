import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const stage = mkdtempSync(join(tmpdir(), 'dsh-context-provenance-tgz-'))
const pnpmCli = process.platform === 'win32'
  ? process.env.PATH?.split(delimiter)
      .filter(directory => directory.toLowerCase().endsWith('bin\\fallback'))
      .map(directory => resolve(directory, '..', '..', 'node', 'node_modules', 'pnpm', 'bin', 'pnpm.mjs'))
      .find(candidate => candidate.includes('codex-primary-runtime'))
  : undefined
const runPnpm = (args, cwd) => {
  const command = pnpmCli !== undefined ? process.execPath : 'pnpm'
  const commandArgs = pnpmCli !== undefined ? [pnpmCli, ...args] : args
  try {
    return execFileSync(command, commandArgs, { cwd, encoding: 'utf8', stdio: 'pipe' })
  } catch (error) {
    const output = [error.stdout, error.stderr]
      .filter(value => typeof value === 'string' && value.length > 0)
      .join('')
    throw new Error(`pnpm ${args.join(' ')} failed:\n${output}`, { cause: error })
  }
}
try {
  runPnpm(['pack', '--pack-destination', stage], root)
  const tarball = join(stage, 'dsh-context-provenance-0.1.0.tgz')
  const project = join(stage, 'consumer')
  mkdirSync(project)
  writeFileSync(join(project, 'package.json'), '{"private":true,"type":"module"}\n')
  const installArgs = ['add', '--ignore-scripts']
  if (process.env.DSH_TGZ_ALLOW_NETWORK !== '1') {
    const storeDir = runPnpm(['store', 'path'], root).trim()
    installArgs.push('--offline', '--store-dir', storeDir)
  }
  installArgs.push(tarball)
  runPnpm(installArgs, project)
  const installed = JSON.parse(readFileSync(join(project, 'node_modules', 'dsh-context-provenance', 'package.json'), 'utf8'))
  if (installed.name !== 'dsh-context-provenance') throw new Error(`unexpected installed package name: ${installed.name}`)
  execFileSync(process.execPath, ['--input-type=module', '--eval', [
    "import * as plugin from 'dsh-context-provenance'",
    "if (plugin.name !== 'context-provenance' || typeof plugin.apply !== 'function') throw new Error('package-name import failed')",
  ].join(';')], { cwd: project, stdio: 'pipe' })
} finally {
  rmSync(stage, { recursive: true, force: true })
}
