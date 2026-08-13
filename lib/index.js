import { isAgentLoopRequest } from "@deepseek-ai/dsh-llm";
import { createHmac, randomBytes } from "node:crypto";
//#region src/core.ts
const REQUEST_SOURCE = "@deepseek-ai/dsh-llm GenerateOptions at llm/stream";
const CONTEXT_SOURCE = "@deepseek-ai/dsh-session request/context";
const INSTRUCTION_SOURCE = "@deepseek-ai/dsh-session user/message.source(agent-instructions)";
const BREAKDOWN_SOURCE = "@deepseek-ai/dsh-token-meter contextBreakdown projection";
const PRESSURE_SOURCE = "@deepseek-ai/dsh-token-meter contextPressure projection";
const SKILL_SOURCE = "@deepseek-ai/dsh-skill SkillRegistry.snapshot";
const PLUGIN_INVENTORY_SOURCE = "@deepseek-ai/dsh-host-plugin-inventory pluginInventory/list";
const FINGERPRINT_KEY = randomBytes(32);
const fingerprints = /* @__PURE__ */ new WeakMap();
var InstructionSourceTracker = class {
	processedEvents = 0;
	scannedEvents = 0;
	active = /* @__PURE__ */ new Map();
};
function createInstructionSourceTracker() {
	return new InstructionSourceTracker();
}
function observed(value, source, note) {
	return {
		status: "Observed",
		value,
		source,
		...note === void 0 ? {} : { note }
	};
}
function estimated(value, source, note) {
	return {
		status: "Estimated",
		value,
		source,
		...note === void 0 ? {} : { note }
	};
}
function unavailable(source, note) {
	return {
		status: "Unavailable",
		source,
		note
	};
}
function instructionSources(agent, tracker) {
	const events = agent.session.events;
	if (events.length < tracker.processedEvents) {
		tracker.processedEvents = 0;
		tracker.active.clear();
	}
	for (let index = tracker.processedEvents; index < events.length; index += 1) {
		const event = events[index];
		if (event === void 0) continue;
		tracker.scannedEvents += 1;
		if (event.type !== "user/message") continue;
		const source = event.data.source;
		if (typeof source !== "object" || source === null || !("kind" in source) || source.kind !== "agent-instructions" || !("changes" in source) || !Array.isArray(source.changes)) continue;
		for (const raw of source.changes) {
			if (typeof raw !== "object" || raw === null || !("action" in raw) || !("scope" in raw) || !("path" in raw) || typeof raw.scope !== "string" || typeof raw.path !== "string") continue;
			const scopeKey = privateFingerprint(raw.scope);
			if (raw.action === "remove") tracker.active.delete(scopeKey);
			else if (raw.action === "set" || raw.action === "replace") tracker.active.set(scopeKey, projectAgentsPath(raw.path, agent.session.header.cwd ?? ""));
		}
	}
	tracker.processedEvents = events.length;
	return [...new Set(tracker.active.values())].sort();
}
function captureRequest(agent, request, ordinal, breakdown, instructionTracker = createInstructionSourceTracker()) {
	const context = agent.session.requestContext();
	const observation = {
		ordinal,
		provider: observed(request.provider, REQUEST_SOURCE),
		model: observed(request.model, REQUEST_SOURCE),
		contextWindow: context?.contextWindow === void 0 ? unavailable(CONTEXT_SOURCE, "The adapter did not advertise a context window.") : observed(context.contextWindow, CONTEXT_SOURCE, "Adapter-advertised capacity, not an independently verified hard limit."),
		systemPresent: observed(request.system !== void 0 && request.system.length > 0, REQUEST_SOURCE, "Only presence is retained; text is never stored."),
		toolNames: observed((request.tools ?? []).map((tool) => tool.name), REQUEST_SOURCE, "Descriptions and parameter schemas are never stored."),
		toolOwners: unavailable("public ToolSchema", "ToolSchema has no owner or plugin provenance field."),
		agentsSources: observed(instructionSources(agent, instructionTracker), INSTRUCTION_SOURCE, "Path categories from durable injections; raw paths, files on disk, and hidden instructions are not exposed."),
		contextBreakdown: {
			systemTokens: estimatedBreakdown(breakdown, "systemTokens"),
			toolsTokens: estimatedBreakdown(breakdown, "toolsTokens"),
			messageTokens: estimatedBreakdown(breakdown, "messageTokens")
		}
	};
	fingerprints.set(observation, {
		system: privateFingerprint(request.system ?? ""),
		tools: privateFingerprint(JSON.stringify(request.tools ?? []))
	});
	return observation;
}
function privateFingerprint(value) {
	return createHmac("sha256", FINGERPRINT_KEY).update(value).digest("hex");
}
function projectAgentsPath(path, cwd) {
	const normalizedPath = path.replaceAll("\\", "/").replace(/\/+$/u, "");
	const normalizedCwd = cwd.replaceAll("\\", "/").replace(/\/+$/u, "");
	const caseFold = /^[A-Za-z]:\//u.test(normalizedPath);
	const candidate = caseFold ? normalizedPath.toLowerCase() : normalizedPath;
	const workspace = caseFold ? normalizedCwd.toLowerCase() : normalizedCwd;
	if (!/^(?:[A-Za-z]:\/|\/|file:)/u.test(normalizedPath)) return normalizedPath.includes("/") ? "workspace-nested" : "workspace-root";
	if (workspace.length > 0 && candidate.startsWith(`${workspace}/`)) return candidate.slice(workspace.length + 1).includes("/") ? "workspace-nested" : "workspace-root";
	return "outside-workspace";
}
function valueOf(field) {
	return field.status === "Unavailable" ? void 0 : field.value;
}
function setDifference(left, right) {
	const other = new Set(right);
	return left.filter((value) => !other.has(value));
}
function compareRequests(previous, current) {
	if (previous === null || current === null) return { available: false };
	const previousTools = valueOf(previous.toolNames) ?? [];
	const currentTools = valueOf(current.toolNames) ?? [];
	const previousAgents = valueOf(previous.agentsSources) ?? [];
	const currentAgents = valueOf(current.agentsSources) ?? [];
	const delta = tokenDelta(previous, current);
	const previousFingerprint = fingerprints.get(previous);
	const currentFingerprint = fingerprints.get(current);
	return {
		available: true,
		providerChanged: valueOf(previous.provider) !== valueOf(current.provider),
		modelChanged: valueOf(previous.model) !== valueOf(current.model),
		systemPresenceChanged: valueOf(previous.systemPresent) !== valueOf(current.systemPresent),
		...previousFingerprint === void 0 || currentFingerprint === void 0 ? {} : {
			systemChanged: previousFingerprint.system !== currentFingerprint.system,
			toolCatalogChanged: previousFingerprint.tools !== currentFingerprint.tools
		},
		addedTools: setDifference(currentTools, previousTools),
		removedTools: setDifference(previousTools, currentTools),
		addedAgentsSources: setDifference(currentAgents, previousAgents),
		removedAgentsSources: setDifference(previousAgents, currentAgents),
		...delta === void 0 ? {} : { estimatedTokenDelta: delta }
	};
}
function tokenDelta(previous, current) {
	const previousSystem = valueOf(previous.contextBreakdown.systemTokens);
	const previousTools = valueOf(previous.contextBreakdown.toolsTokens);
	const previousMessages = valueOf(previous.contextBreakdown.messageTokens);
	const currentSystem = valueOf(current.contextBreakdown.systemTokens);
	const currentTools = valueOf(current.contextBreakdown.toolsTokens);
	const currentMessages = valueOf(current.contextBreakdown.messageTokens);
	if (previousSystem === void 0 || previousTools === void 0 || previousMessages === void 0 || currentSystem === void 0 || currentTools === void 0 || currentMessages === void 0) return void 0;
	return {
		systemTokens: currentSystem - previousSystem,
		toolsTokens: currentTools - previousTools,
		messageTokens: currentMessages - previousMessages
	};
}
function estimatedBreakdown(projection, key) {
	return projection === void 0 ? unavailable(BREAKDOWN_SOURCE, "The contextBreakdown projection is not registered in this composition.") : estimated(projection[key], BREAKDOWN_SOURCE, "Official fixed heuristic; not provider tokenization or billing.");
}
function pressureField(projection, key) {
	const value = projection?.[key];
	if (value === void 0) return unavailable(PRESSURE_SOURCE, "No provider usage anchor is available yet.");
	return key === "pressureTokens" ? observed(value, PRESSURE_SOURCE, "Derived from provider-reported input and cache usage buckets.") : estimated(value, PRESSURE_SOURCE, "Provider usage anchor plus an official heuristic surface delta.");
}
function buildReport(input) {
	const skillNote = input.skillsError === void 0 ? "The skills service is not present in this composition." : "Skill discovery failed; provider details were withheld.";
	const pluginNote = input.pluginsError === void 0 ? "The official plugin inventory service is absent in this composition." : "Plugin inventory failed; provider details were withheld.";
	const skillEntries = input.skills?.skills.map((skill) => ({
		name: skill.name,
		sourceCategory: skillSourceCategory(skill.source),
		providerCategory: skillProviderCategory(skill.provider)
	}));
	return {
		schemaVersion: 2,
		scope: "requesting-agent",
		requests: {
			current: input.current,
			previous: input.previous,
			comparison: compareRequests(input.previous, input.current)
		},
		tokens: {
			systemTokens: estimatedBreakdown(input.breakdown, "systemTokens"),
			toolsTokens: estimatedBreakdown(input.breakdown, "toolsTokens"),
			messageTokens: estimatedBreakdown(input.breakdown, "messageTokens"),
			pressureTokens: pressureField(input.pressure, "pressureTokens"),
			projectedTokens: pressureField(input.pressure, "projectedTokens")
		},
		skills: {
			complete: input.skills === void 0 ? unavailable(SKILL_SOURCE, skillNote) : observed(input.skills.complete, SKILL_SOURCE, input.skills.complete ? void 0 : "Provider discovery was incomplete; absence is not authoritative."),
			entries: skillEntries === void 0 ? unavailable(SKILL_SOURCE, skillNote) : observed(skillEntries, SKILL_SOURCE, input.skills?.complete === false ? "Partial current observation." : void 0)
		},
		plugins: {
			entries: input.plugins === void 0 ? unavailable(PLUGIN_INVENTORY_SOURCE, pluginNote) : observed(input.plugins.map((entry, index) => ({
				index,
				moduleKind: moduleKind(entry.moduleName),
				enabled: entry.enabled,
				fiberPhase: entry.fiberPhase
			})), PLUGIN_INVENTORY_SOURCE, "Ordered point-in-time state with module syntax categories; entry ids and module specifiers are intentionally withheld."),
			contributionMapping: unavailable("pluginInventory/list and public schemas", "No public interface maps a Loader entry to request tools, skills, prompts, or AGENTS sources.")
		},
		unavailable: {
			status: "Unavailable",
			source: "public DeepSeek Harness interfaces",
			note: "No public interface exposes these fields.",
			value: [
				"hidden policy and private system instructions",
				"tools hidden from the requesting agent",
				"tool-to-plugin ownership",
				"plugin bundle/profile/override provenance",
				"complete causal explanation of behavior differences"
			]
		}
	};
}
function skillSourceCategory(source) {
	switch (source) {
		case "project-dsh":
		case "project-agents":
		case "runtime":
		case "user-dsh":
		case "user-agents":
		case "custom":
		case "bundled": return source;
		default: return "other";
	}
}
function skillProviderCategory(provider) {
	if (provider === "runtime") return "runtime";
	if (provider === "filesystem" || provider.includes("skill-filesystem")) return "filesystem";
	if (provider.startsWith("@") || provider.includes("/")) return "package";
	return "other";
}
function moduleKind(moduleName) {
	if (moduleName.startsWith("file:")) return "file-url";
	if (/^(?:[A-Za-z]:[\\/]|\/)/u.test(moduleName)) return "absolute-path";
	if (/^\.{1,2}[\\/]/u.test(moduleName)) return "relative-path";
	if (/^(?:cordis|node):/u.test(moduleName)) return "builtin";
	if (/^[a-z][a-z0-9+.-]*:/iu.test(moduleName)) return "url";
	if (/^(?:@[a-z0-9._~-]+\/)?[a-z0-9._~-]+(?:\/.*)?$/iu.test(moduleName)) return "package";
	return "other";
}
//#endregion
//#region src/index.ts
const name = "context-provenance";
const EMPTY_INPUT = {
	type: "object",
	properties: {},
	additionalProperties: false
};
const OUTPUT = { description: "Context provenance evidence report." };
function shift(pair, observation) {
	pair.previous = pair.current;
	pair.current = observation;
}
function provider(ctx, observations) {
	return {
		manifest: {
			id: "ContextProvenance",
			description: "Privacy-minimal evidence ledger for the requesting Agent. Every field is Observed, Estimated, or Unavailable.",
			methods: [{
				name: "report",
				description: "Compare the two most recent observed ordinary requests and report public token, skill, AGENTS, and provenance evidence without sensitive bodies.",
				inputSchema: EMPTY_INPUT,
				outputSchema: OUTPUT
			}]
		},
		async query(method, _input, { agent, signal }) {
			if (method !== "report") throw new Error(`unknown ContextProvenance method "${method}"`);
			signal.throwIfAborted();
			const pair = observations.get(agent) ?? {
				previous: null,
				current: null
			};
			const values = ctx.get("sessionProjections", false)?.snapshot(agent.session).values;
			const breakdown = values?.contextBreakdown;
			const pressure = values?.contextPressure;
			const skills = ctx.get("skills", false);
			const pluginInventory = ctx.get("pluginInventory", false);
			let skillSnapshot;
			let skillsError;
			if (skills !== void 0) try {
				skillSnapshot = await skills.snapshot({
					cwd: agent.session.header.cwd,
					signal,
					scope: agent
				});
			} catch {
				skillsError = "withheld";
			}
			signal.throwIfAborted();
			let plugins;
			let pluginsError;
			if (pluginInventory !== void 0) try {
				plugins = pluginInventory.list().entries.map((entry) => ({
					...entry,
					entryId: String(entry.entryId)
				}));
			} catch {
				pluginsError = "withheld";
			}
			return buildReport({
				previous: pair.previous,
				current: pair.current,
				...breakdown === void 0 ? {} : { breakdown },
				...pressure === void 0 ? {} : { pressure },
				...skillSnapshot === void 0 ? {} : { skills: skillSnapshot },
				...skillsError === void 0 ? {} : { skillsError },
				...pluginsError === void 0 ? {} : { pluginsError },
				...plugins === void 0 ? {} : { plugins }
			});
		}
	};
}
/** Register the observer and its read-only inspect report. */
function apply(ctx) {
	const observations = /* @__PURE__ */ new WeakMap();
	const instructionTrackers = /* @__PURE__ */ new WeakMap();
	ctx.inject(["cordisInspect"], (inspectCtx) => {
		inspectCtx.effect(() => inspectCtx.cordisInspect.register(provider(inspectCtx, observations)), "context-provenance: inspect provider");
	});
	ctx.on("llm/stream", function(request, next) {
		if (isAgentLoopRequest(request) && request.purpose === void 0 && request.sessionId !== void 0) try {
			const agent = ctx.get("agents", false)?.get(request.sessionId);
			if (agent !== void 0) {
				const pair = observations.get(agent) ?? {
					previous: null,
					current: null
				};
				const instructionTracker = instructionTrackers.get(agent) ?? createInstructionSourceTracker();
				const breakdown = ctx.get("sessionProjections", false)?.snapshot(agent.session).values.contextBreakdown;
				shift(pair, captureRequest(agent, request, (pair.current?.ordinal ?? 0) + 1, breakdown, instructionTracker));
				observations.set(agent, pair);
				instructionTrackers.set(agent, instructionTracker);
			}
		} catch (error) {
			ctx.logger.warn(`context-provenance observation skipped: ${error instanceof Error ? error.message : String(error)}`);
		}
		return next();
	});
}
//#endregion
export { apply, buildReport, captureRequest, compareRequests, createInstructionSourceTracker, name };
