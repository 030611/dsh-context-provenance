/** Observe-only context provenance over public DSH runtime interfaces. */
import type { Context } from '@deepseek-ai/cordis';
export type * from './types.ts';
export { buildReport, captureRequest, compareRequests } from './core.ts';
export declare const name = "context-provenance";
/** Register the observer and its read-only inspect report. */
export declare function apply(ctx: Context): void;
