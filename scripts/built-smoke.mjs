import * as plugin from '../lib/index.js'

if (plugin.name !== 'context-provenance') throw new Error(`unexpected plugin name: ${String(plugin.name)}`)
if (typeof plugin.apply !== 'function') throw new Error('built plugin has no apply export')
if (plugin.default !== undefined) throw new Error('function plugin must not export default')
