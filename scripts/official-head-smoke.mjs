import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

const expected = '47f943859bef60e4160492346772ded9b24f765a'
const official = resolve('..', 'deepseek-harness-plugin-20260813', 'dsh')
const actual = execFileSync('git', ['-C', official, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
if (actual !== expected) throw new Error(`official DSH HEAD drifted: expected ${expected}, received ${actual}`)
const status = execFileSync('git', ['-C', official, 'status', '--porcelain=v1'], { encoding: 'utf8' })
if (status !== '') throw new Error('official DSH checkout is not clean')
