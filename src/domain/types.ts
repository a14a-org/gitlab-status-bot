/** Terminal job/pipeline states — no further updates are expected. */
export const TERMINAL_STATUSES = ['success', 'failed', 'canceled', 'skipped', 'manual'] as const;

export type JobStatus =
    | 'created'
    | 'pending'
    | 'running'
    | 'success'
    | 'failed'
    | 'canceled'
    | 'skipped'
    | 'manual';

export interface Job {
    id: number;
    name: string;
    stage: string;
    status: JobStatus;
    allowFailure: boolean;
    /** Epoch millis, used for ordering and duration. */
    finishedAt?: number;
}

export interface PipelineSnapshot {
    id: number;
    /** GitLab pipeline source: `push`, `merge_request_event`, `schedule`, … */
    source: string;
    status: JobStatus;
    /** Stage names present in this pipeline, in GitLab's declared order. */
    stages: string[];
    jobs: Record<string, Job>;
    webUrl?: string;
    durationSeconds?: number;
    updatedAt: number;
}

export interface MergeRequestRef {
    iid: number;
    title: string;
    url: string;
    targetBranch: string;
}

/**
 * One Slack card per commit. A push pipeline and its detached merge-request
 * pipeline share a SHA, so they share a card instead of producing two.
 */
export interface CommitState {
    projectId: number;
    sha: string;
    /** Source branch name (identical across the push and MR pipelines). */
    ref: string;
    projectName: string;
    commitTitle: string;
    commitUrl: string;
    authorName: string;
    mergeRequest?: MergeRequestRef;
    pipelines: Record<string, PipelineSnapshot>;
    /** Slack message identity. Absent until the card has been posted. */
    channel?: string;
    ts?: string;
    /** Job ids whose log has already been posted into the thread. */
    postedLogJobIds: number[];
    /** Set when the full job breakdown has been posted into the thread. */
    detailsPosted: boolean;
    /** Hash of the last rendered card, to skip no-op Slack updates. */
    lastRenderHash?: string;
    createdAt: number;
    updatedAt: number;
}

export const isTerminal = (status: string): boolean =>
    (TERMINAL_STATUSES as readonly string[]).includes(status);

export const commitKey = (projectId: number, sha: string): string => `${projectId}_${sha}`;
