export interface PipelineMessage {
    ts: string;
    channel: string;
    expandedStages: Set<string>;
    lastPipelineData: any;
}

const pipelineStateCache = new Map<number, PipelineMessage>();

export const getPipelineState = (pipelineId: number): PipelineMessage | undefined => {
    return pipelineStateCache.get(pipelineId);
};

export const setPipelineState = (pipelineId: number, message: PipelineMessage): void => {
    pipelineStateCache.set(pipelineId, message);
};

export const deletePipelineState = (pipelineId: number): void => {
    pipelineStateCache.delete(pipelineId);
};
