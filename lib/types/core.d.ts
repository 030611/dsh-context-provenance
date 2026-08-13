import type { GenerateOptions } from '@deepseek-ai/dsh-llm';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { ContextBreakdownProjection, ContextPressureProjection } from '@deepseek-ai/dsh-token-meter';
import type { SkillCatalogSnapshot } from '@deepseek-ai/dsh-skill';
import type { ContextProvenanceReport, EvidenceField, RequestComparison, RequestObservation } from './types.ts';
export declare class InstructionSourceTracker {
    processedEvents: number;
    scannedEvents: number;
    readonly active: Map<string, string>;
}
export declare function createInstructionSourceTracker(): InstructionSourceTracker;
export declare function observed<T>(value: T, source: string, note?: string): EvidenceField<T>;
export declare function estimated<T>(value: T, source: string, note?: string): EvidenceField<T>;
export declare function unavailable<T>(source: string, note: string): EvidenceField<T>;
export declare function captureRequest(agent: Agent, request: GenerateOptions, ordinal: number, breakdown?: ContextBreakdownProjection, instructionTracker?: InstructionSourceTracker): RequestObservation;
export declare function compareRequests(previous: RequestObservation | null, current: RequestObservation | null): RequestComparison;
export declare function buildReport(input: {
    previous: RequestObservation | null;
    current: RequestObservation | null;
    breakdown?: ContextBreakdownProjection;
    pressure?: ContextPressureProjection;
    skills?: SkillCatalogSnapshot;
    skillsError?: string;
    pluginsError?: string;
    plugins?: ReadonlyArray<{
        entryId: string;
        moduleName: string;
        enabled: boolean;
        fiberPhase: 'pending' | 'loading' | 'active' | 'failed' | 'unloading' | null;
    }>;
}): ContextProvenanceReport;
