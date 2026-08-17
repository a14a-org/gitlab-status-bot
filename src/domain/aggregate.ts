import { config } from '../config';
import { CommitState, Job, JobStatus, PipelineSnapshot, isTerminal } from './types';

export interface StageRollup {
    name: string;
    status: JobStatus;
    total: number;
    done: number;
    failed: number;
}

export interface CommitRollup {
    status: JobStatus;
    stages: StageRollup[];
    jobs: Job[];
    failedJobs: Job[];
    pipelines: PipelineSnapshot[];
    durationSeconds: number;
    /** True when every pipeline attached to the commit has reached a terminal state. */
    complete: boolean;
}

/**
 * Stage precedence when merging pipelines that declare overlapping stages.
 * The union is ordered by first appearance across pipelines, which preserves
 * GitLab's declared order without hardcoding any project's stage names.
 */
const mergeStageOrder = (pipelines: PipelineSnapshot[]): string[] => {
    const order: string[] = [];
    for (const pipeline of pipelines) {
        for (const stage of pipeline.stages) {
            if (!order.includes(stage)) {
                order.push(stage);
            }
        }
    }
    return order;
};

const rollUpStage = (name: string, jobs: Job[]): StageRollup => {
    const effective = jobs.filter((job) => job.status !== 'skipped');
    const failed = effective.filter((job) => job.status === 'failed' && !job.allowFailure);
    const done = effective.filter((job) => isTerminal(job.status));

    let status: JobStatus;
    if (failed.length > 0) {
        status = 'failed';
    } else if (effective.length > 0 && done.length === effective.length) {
        status = 'success';
    } else if (effective.some((job) => job.status === 'running')) {
        status = 'running';
    } else if (effective.every((job) => job.status === 'created' || job.status === 'manual')) {
        status = 'created';
    } else {
        status = 'pending';
    }

    return {
        name,
        status,
        total: effective.length,
        done: done.length,
        failed: failed.length,
    };
};

/**
 * Collapse every pipeline attached to a commit into a single view model.
 *
 * Jobs are keyed by GitLab job id, so the same job arriving from both the
 * pipeline hook and a job hook updates in place rather than duplicating.
 */
export const rollUp = (state: CommitState): CommitRollup => {
    const pipelines = Object.values(state.pipelines).sort((a, b) => a.id - b.id);
    const jobsById = new Map<number, Job>();

    for (const pipeline of pipelines) {
        for (const job of Object.values(pipeline.jobs)) {
            jobsById.set(job.id, job);
        }
    }

    const jobs = [...jobsById.values()];
    const stageOrder = mergeStageOrder(pipelines);
    const jobsByStage = new Map<string, Job[]>();
    for (const job of jobs) {
        const bucket = jobsByStage.get(job.stage);
        if (bucket) {
            bucket.push(job);
        } else {
            jobsByStage.set(job.stage, [job]);
        }
    }

    // A stage can exist in `stages` before any of its jobs are created.
    const stageNames = [...stageOrder];
    for (const stage of jobsByStage.keys()) {
        if (!stageNames.includes(stage)) {
            stageNames.push(stage);
        }
    }

    const stages = stageNames.map((name) => rollUpStage(name, jobsByStage.get(name) ?? []));
    const failedJobs = jobs.filter((job) => job.status === 'failed' && !job.allowFailure);
    const complete = pipelines.length > 0 && pipelines.every((p) => isTerminal(p.status));

    let status: JobStatus;
    if (failedJobs.length > 0) {
        status = 'failed';
    } else if (complete) {
        status = pipelines.some((p) => p.status === 'canceled') ? 'canceled' : 'success';
    } else if (jobs.some((job) => job.status === 'running')) {
        status = 'running';
    } else {
        status = 'pending';
    }

    const durationSeconds = pipelines.reduce(
        (max, pipeline) => Math.max(max, pipeline.durationSeconds ?? 0),
        0
    );

    return { status, stages, jobs, failedJobs, pipelines, durationSeconds, complete };
};

/**
 * Decides whether a commit deserves a top-level channel message.
 *
 * A commit qualifies when its branch is on the configured deploy list, or when
 * any of its pipelines actually contains a deploy stage. The second rule means
 * a new branch that starts deploying is picked up without a config change.
 */
export const shouldPostCard = (state: CommitState, rollup: CommitRollup): boolean => {
    const branch = state.ref;
    if (config.deployBranches().includes(branch)) {
        return true;
    }

    const deployStage = config.deployStagePattern();
    const hasDeployStage = rollup.pipelines.some((pipeline) =>
        pipeline.stages.some((stage) => deployStage.test(stage))
    );
    if (hasDeployStage) {
        return true;
    }

    return config.postNonDeployFailures() && rollup.status === 'failed';
};
