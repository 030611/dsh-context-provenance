import { isAgentLoopRequest } from "@deepseek-ai/dsh-llm";
import { createHash } from "node:crypto";
//#region src/core.ts
const REQUEST_SOURCE = "@deepseek-ai/dsh-llm GenerateOptions at llm/stream";
const CONTEXT_SOURCE = "@deepseek-ai/dsh-session request/context";
const INSTRUCTION_SOURCE = "@deepseek-ai/dsh-session user/message.source(agent-instructions)";
const BREAKDOWN_SOURCE = "@deepseek-ai/dsh-token-meter contextBreakdown projection";
const PRESSURE_SOURCE = "@deepseek-ai/dsh-token-meter contextPressure projection";
const SKILL_SOURCE = "@deepseek-ai/dsh-skill SkillRegistry.snapshot";
const PLUGIN_INVENTORY_SOURCE = "@deepseek-ai/dsh-host-plugin-inventory pluginInventory/list";
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
function instructionSources(agent) {
	const active = /* @__PURE__ */ new Map();
	for (const event of agent.session.events) {
		if (event.type !== "user/message") continue;
		const source = event.data.source;
		if (typeof source !== "object" || source === null || !("kind" in source) || source.kind !== "agent-instructions" || !("changes" in source) || !Array.isArray(source.changes)) continue;
		for (const raw of source.changes) {
			if (typeof raw !== "object" || raw === null || !("action" in raw) || !("scope" in raw) || !("path" in raw) || typeof raw.scope !== "string" || typeof raw.path !== "string") continue;
			if (raw.action === "remove") active.delete(raw.scope);
			else if (raw.action === "set" || raw.action === "replace") active.set(raw.scope, raw.path);
		}
	}
	return [...new Set(active.values())].sort();
}
function captureRequest(agent, request, ordinal, breakdown) {
	const context = agent.session.requestContext();
	return {
		ordinal,
		provider: observed(request.provider, REQUEST_SOURCE),
		model: observed(request.model, REQUEST_SOURCE),
		contextWindow: context?.contextWindow === void 0 ? unavailable(CONTEXT_SOURCE, "The adapter did not advertise a context window.") : observed(context.contextWindow, CONTEXT_SOURCE, "Adapter-advertised capacity, not an independently verified hard limit."),
		systemPresent: observed(request.system !== void 0 && request.system.length > 0, REQUEST_SOURCE, "Only presence is retained; text is never stored."),
		systemSha256: observed(sha256(request.system ?? ""), REQUEST_SOURCE, "One-way equality fingerprint; prompt text is never retained."),
		toolNames: observed((request.tools ?? []).map((tool) => tool.name), REQUEST_SOURCE, "Descriptions and parameter schemas are never stored."),
		toolCatalogSha256: observed(sha256(JSON.stringify(request.tools ?? [])), REQUEST_SOURCE, "One-way equality fingerprint; schema bodies are never retained."),
		toolOwners: unavailable("public ToolSchema", "ToolSchema has no owner or plugin provenance field."),
		agentsSources: observed(instructionSources(agent), INSTRUCTION_SOURCE, "Paths recorded by durable injections; not all files on disk or hidden instructions."),
		contextBreakdown: {
			systemTokens: estimatedBreakdown(breakdown, "systemTokens"),
			toolsTokens: estimatedBreakdown(breakdown, "toolsTokens"),
			messageTokens: estimatedBreakdown(breakdown, "messageTokens")
		}
	};
}
function sha256(value) {
	return createHash("sha256").update(value).digest("hex");
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
	return {
		available: true,
		providerChanged: valueOf(previous.provider) !== valueOf(current.provider),
		modelChanged: valueOf(previous.model) !== valueOf(current.model),
		systemPresenceChanged: valueOf(previous.systemPresent) !== valueOf(current.systemPresent),
		systemChanged: valueOf(previous.systemSha256) !== valueOf(current.systemSha256),
		toolCatalogChanged: valueOf(previous.toolCatalogSha256) !== valueOf(current.toolCatalogSha256),
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
	const skillNote = input.skillsError ?? "The skills service is not present in this composition.";
	const skillEntries = input.skills?.skills.map((skill) => ({
		name: skill.name,
		source: skill.source,
		provider: skill.provider
	}));
	return {
		schemaVersion: 1,
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
			entries: input.plugins === void 0 ? unavailable(PLUGIN_INVENTORY_SOURCE, "The official plugin inventory service is absent in this composition.") : observed(input.plugins, PLUGIN_INVENTORY_SOURCE, "Point-in-time Loader entries only; not contribution or configuration provenance."),
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
			} catch (error) {
				skillsError = `Skill discovery failed: ${error instanceof Error ? error.message : String(error)}`;
			}
			signal.throwIfAborted();
			const plugins = pluginInventory?.list().entries.map((entry) => ({
				...entry,
				entryId: String(entry.entryId)
			}));
			return buildReport({
				previous: pair.previous,
				current: pair.current,
				...breakdown === void 0 ? {} : { breakdown },
				...pressure === void 0 ? {} : { pressure },
				...skillSnapshot === void 0 ? {} : { skills: skillSnapshot },
				...skillsError === void 0 ? {} : { skillsError },
				...plugins === void 0 ? {} : { plugins }
			});
		}
	};
}
/** Register the observer and its read-only inspect report. */
function apply(ctx) {
	const observations = /* @__PURE__ */ new WeakMap();
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
				const breakdown = ctx.get("sessionProjections", false)?.snapshot(agent.session).values.contextBreakdown;
				shift(pair, captureRequest(agent, request, (pair.current?.ordinal ?? 0) + 1, breakdown));
				observations.set(agent, pair);
			}
		} catch (error) {
			ctx.logger.warn(`context-provenance observation skipped: ${error instanceof Error ? error.message : String(error)}`);
		}
		return next();
	});
}
//#endregion
export { apply, buildReport, captureRequest, compareRequests, name };
