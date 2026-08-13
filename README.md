# dsh-context-provenance

An observe-only, CPU-only, local-only DeepSeek Harness plugin that reports what public runtime interfaces can actually prove about the requesting Agent's context. It retains only the two most recent ordinary agent-loop request observations in memory and exposes them through the existing Cordis inspect query mechanism. It performs no file, network, subprocess, GPU, persistence, session, permission, tool, model-routing, or request mutation.

## Audit verdict

Conditional pass against official DSH commit `47f943859bef60e4160492346772ded9b24f765a`. Stable public seams exist for a deliberately incomplete evidence ledger. This plugin is not a complete context provenance graph and cannot explain all behavior differences.

Public collision review found official `pluginInventory/list`, official token-meter projections, official Cordis inspect, and the community `dsh-context-doctor`. This plugin does not rescan files, reimplement token estimation, add optimization advice, or add another token-breakdown UI. Its distinct surface is strict evidence labeling plus adjacent actual request comparison.

## Evidence matrix

| Field | Label | Public interface | Boundary |
|---|---|---|---|
| Effective request provider/model | Observed | `llm/stream` `GenerateOptions`, gated by `isAgentLoopRequest()` | Ordinary Agent-loop requests only |
| Adapter context window | Observed | `Session.requestContext()` | Adapter-advertised capacity, optional |
| System presence and SHA-256 | Observed | `GenerateOptions.system` | No text retained; digest proves equality only |
| Tool names and catalog SHA-256 | Observed | `GenerateOptions.tools` | No descriptions/parameter schemas retained |
| Tool owner/plugin mapping | Unavailable | Public `ToolSchema` has no owner | No inference from names |
| Active AGENTS sources | Observed | Durable `user/message.source.kind=agent-instructions` changes | Injected paths only; not every file on disk |
| Skill name/source/provider | Observed or partial | `ctx.skills.snapshot({ cwd, scope })` | `complete=false` is explicitly incomplete |
| Loader entry id/module/enabled/fiber phase | Observed | Official `pluginInventory/list` service | Point-in-time inventory, not contribution provenance |
| System/tools/messages breakdown | Estimated | Official `contextBreakdown` projection | Fixed heuristic; not provider tokenization or billing |
| Prompt pressure | Observed | Official `contextPressure.pressureTokens` | Derived from provider-reported usage buckets |
| Projected next prompt | Estimated | Official `contextPressure.projectedTokens` | Provider anchor plus heuristic delta |
| Hidden policies/private prompts/hidden tools | Unavailable | No public interface | Never claimed or inferred |
| Complete behavior causality | Unavailable | No public interface | Adjacent changes are correlation, not explanation |

Every returned field carries `Observed`, `Estimated`, or `Unavailable`, its source interface, and a boundary note where needed. Missing services, projection keys, optional fields, or incomplete skill discovery degrade per field; absence is never silently converted to zero.

## Usage

Add the bundle to a profile, restart DSH, then use the existing inspect tools to query Host provider `ContextProvenance`, method `report`. The provider appears when the official Cordis inspect service is present; an older composition without that service still mounts the observer but has no query surface. The provider is model-visible only when a user or model explicitly inspects it; the plugin adds no new tool schema or ordinary request content.

## Privacy and lifecycle

Request bodies are synchronously reduced at the `llm/stream` boundary to provider/model, booleans, names, official numeric projections, recorded paths, and SHA-256 equality fingerprints. System text, messages, tool descriptions, JSON parameter schemas, skill bodies, and AGENTS contents are never retained or returned. The in-memory two-request WeakMap, request listener, and inspect registration become unreachable or are disposed with the plugin Fiber. Restarting or unloading loses all observations.

## Version degradation

The official repository is pre-release and advertises no session-format compatibility promise. This package binds only published package exports and public methods/events at the pinned audit commit. Missing optional services or newer fields produce `Unavailable`; a missing `cordisInspect` service removes only the report surface and does not prevent the observer from mounting.

## Model experience

The plugin adds one entry and one method to the existing Cordis inspect provider directory. Ordinary model requests receive no added prompt, message, or tool schema. A deliberate inspect call returns the bounded evidence report, which then enters normal tool-result history under the existing Cordis inspect tool.

### Token and KV-cache effect

No direct effect on ordinary requests. A deliberate inspect call adds its bounded result to conversation history. The existing inspect tool schema remains unchanged.

## Known limitations

- Loader entries do not identify the bundle, profile, override, or dependency that introduced them.
- A tool name or schema does not identify its owning plugin.
- Skill summaries describe the current winning registry observation, not proof that every listed skill body appeared in a past request.
- AGENTS paths are durable injected-source metadata, not a filesystem inventory or proof of hidden instructions.
- Adjacent observations cover actual ordinary `llm/stream` calls seen while this plugin is mounted. Earlier requests, auxiliary calls, and observations lost on unload or restart are unavailable.
