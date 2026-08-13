# Collision and public-interface audit

Baseline: DeepSeek Harness `47f943859bef60e4160492346772ded9b24f765a` (`master`, clean at audit time).

## Official overlap checked

- Cordis inspect already supplies the query directory and transport. This package contributes one bounded Host provider; it does not add an inspect tool.
- `pluginInventory/list` already projects Loader `entryId`, exact `moduleName`, effective `enabled`, and point-in-time `fiberPhase`. This package consumes that official service and does not infer bundle/profile/override provenance.
- the Web Context Meter already displays token-meter `contextBreakdown`. This package does not estimate tokens or add a competing meter; it reuses the official projection only inside the adjacent-request evidence report.
- `request/header` and `request/context` are change-logged durable state, not one event per provider attempt. Adjacent observations therefore use the public `llm/stream` waterfall plus `isAgentLoopRequest()` and exclude auxiliary `purpose` calls.
- the public Skill registry exposes current winning `name`, `source`, and `provider`; `complete=false` remains partial. Durable `agent-instructions` message sources expose only paths/actions actually recorded as injected. Neither is expanded by reading files.

## Bound source locations

| Surface | Official source at pinned commit | What is used |
|---|---|---|
| actual DSH request boundary | `packages/llm/llm/src/index.ts:51-64,911-928`; `src/types.ts:320-355`; `src/call-config.ts:61-77` | provider/model, system presence/fingerprint, tool names/fingerprint |
| route metadata | `packages/core/session/src/types.ts:212-220`; `src/index.ts:682-699` | optional advertised context window |
| request state | `packages/core/agent-loop/src/agent.ts:438-483` | audit proof that header/context are change-logged, not request counters |
| token projections | `packages/llm/token-meter/src/projection.ts:20-65`; `breakdown-projection.ts:42-69`; `usage-projection.ts:142-205` | official breakdown (Estimated), pressure (provider-reported-derived), projection (Estimated) |
| skills | `packages/skill/skill/src/index.ts:55-93,463-490` | current scoped summary fields only |
| AGENTS injections | `packages/context/agent-instructions/src/state.ts:36-51`; `render.ts:47-50` | durable path/action/scope metadata only |
| tools | `packages/core/tools/src/index.ts:1221-1235,1255-1261` | request tool names; no owner field exists |
| plugins | `packages/host/plugin-inventory/src/index.ts:42-69`; `src/types.ts:15-27` | current Loader fields only |
| inspect lifecycle | `packages/extensions/cordis-host-runner/src/inspect-registry.ts:16-30,57-70,98-126` | scoped Agent query, cancellation, disposer |

## Community overlap checked

- `awesome-dsh-plugin/awesome-dsh-plugin` catalogs community work.
- `Zhenyu98/dsh-context-doctor` scans files and offers context optimization/estimation. This package deliberately does neither: it reports only public runtime evidence with per-field confidence and adjacent actual-request changes.
- Local sibling reviews found evidence receipts, telemetry redaction, verification receipts, prompt snippets, and session bookmarks; none supplies this strict field matrix plus adjacent request comparison.

## Hard boundary

Unavailable means unavailable. The report never claims tool-to-plugin ownership, prompt-section ownership, every skill/AGENTS candidate, hidden provider policy, private system instructions, tools hidden from the requesting Agent, remote HTTP receipt, or a complete causal explanation of behavior differences.
