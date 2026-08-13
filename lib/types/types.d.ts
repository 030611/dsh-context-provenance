/** Evidence confidence used by every report field. */
export type EvidenceStatus = 'Observed' | 'Estimated' | 'Unavailable';
/** One value bound to its public runtime source and confidence. */
export interface EvidenceField<T> {
    status: EvidenceStatus;
    value?: T;
    source: string;
    note?: string;
}
/** Metadata captured synchronously at one ordinary agent-loop request boundary. */
export interface RequestObservation {
    ordinal: number;
    provider: EvidenceField<string>;
    model: EvidenceField<string>;
    contextWindow: EvidenceField<number>;
    systemPresent: EvidenceField<boolean>;
    systemSha256: EvidenceField<string>;
    toolNames: EvidenceField<string[]>;
    toolCatalogSha256: EvidenceField<string>;
    toolOwners: EvidenceField<never>;
    agentsSources: EvidenceField<string[]>;
    contextBreakdown: {
        systemTokens: EvidenceField<number>;
        toolsTokens: EvidenceField<number>;
        messageTokens: EvidenceField<number>;
    };
}
/** Observable changes between the two retained ordinary requests. */
export interface RequestComparison {
    available: boolean;
    providerChanged?: boolean;
    modelChanged?: boolean;
    systemPresenceChanged?: boolean;
    systemChanged?: boolean;
    toolCatalogChanged?: boolean;
    addedTools?: string[];
    removedTools?: string[];
    addedAgentsSources?: string[];
    removedAgentsSources?: string[];
    estimatedTokenDelta?: {
        systemTokens: number;
        toolsTokens: number;
        messageTokens: number;
    };
}
/** Privacy-minimal report returned by the Cordis inspect provider. */
export interface ContextProvenanceReport {
    schemaVersion: 1;
    scope: 'requesting-agent';
    requests: {
        current: RequestObservation | null;
        previous: RequestObservation | null;
        comparison: RequestComparison;
    };
    tokens: {
        systemTokens: EvidenceField<number>;
        toolsTokens: EvidenceField<number>;
        messageTokens: EvidenceField<number>;
        pressureTokens: EvidenceField<number>;
        projectedTokens: EvidenceField<number>;
    };
    skills: {
        complete: EvidenceField<boolean>;
        entries: EvidenceField<Array<{
            name: string;
            source: string;
            provider: string;
        }>>;
    };
    plugins: {
        entries: EvidenceField<Array<{
            entryId: string;
            moduleName: string;
            enabled: boolean;
            fiberPhase: 'pending' | 'loading' | 'active' | 'failed' | 'unloading' | null;
        }>>;
        contributionMapping: EvidenceField<never>;
    };
    unavailable: EvidenceField<string[]>;
}
