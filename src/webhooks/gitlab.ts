import { App } from '@slack/bolt';
import { NextFunction, Request, Response, Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { config } from '../config';
import { CommitState, Job, JobStatus, PipelineSnapshot, isTerminal } from '../domain/types';
import { logger } from '../logging';
import { scheduleRender } from '../services/renderQueue';
import { updateCommitState } from '../state/commitState';

const safeEqual = (a: string, b: string): boolean => {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && timingSafeEqual(left, right);
};

const verifyGitlabToken = (req: Request, res: Response, next: NextFunction): void => {
    const token = req.header('X-Gitlab-Token');
    if (!token || !safeEqual(token, config.gitlab.webhookSecret())) {
        logger.warn('Rejected webhook with invalid token', { objectKind: req.body?.object_kind });
        res.status(401).send('Unauthorized');
        return;
    }
    next();
};

const toJob = (build: Record<string, unknown>): Job => ({
    id: Number(build.id),
    name: String(build.name),
    stage: String(build.stage),
    status: String(build.status) as JobStatus,
    allowFailure: Boolean(build.allow_failure),
});

const baseState = (projectId: number, sha: string): CommitState => ({
    projectId,
    sha,
    ref: '',
    projectName: '',
    commitTitle: '',
    commitUrl: '',
    authorName: 'unknown',
    pipelines: {},
    postedLogJobIds: [],
    detailsPosted: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
});

/** Applies a `pipeline` hook to the commit document. */
const applyPipelineEvent = (current: CommitState | undefined, event: any): CommitState => {
    const attrs = event.object_attributes;
    const projectId = Number(event.project.id);
    const sha = String(attrs.sha);
    const state = current ?? baseState(projectId, sha);

    const jobs: Record<string, Job> = {};
    for (const build of event.builds ?? []) {
        const job = toJob(build);
        jobs[String(job.id)] = job;
    }

    const existing = state.pipelines[String(attrs.id)];
    const snapshot: PipelineSnapshot = {
        id: Number(attrs.id),
        source: String(attrs.source ?? 'unknown'),
        status: String(attrs.status) as JobStatus,
        stages: (attrs.stages ?? []).map(String),
        // Merge rather than replace: a job hook may already have delivered a
        // fresher status than this pipeline payload carries.
        jobs: { ...(existing?.jobs ?? {}), ...jobs },
        webUrl: attrs.url ? String(attrs.url) : existing?.webUrl,
        durationSeconds: Number(attrs.duration ?? existing?.durationSeconds ?? 0),
        updatedAt: Date.now(),
    };

    return {
        ...state,
        ref: String(attrs.ref ?? state.ref),
        projectName: String(event.project?.name ?? state.projectName),
        commitTitle: String(event.commit?.title ?? event.commit?.message ?? state.commitTitle)
            .split('\n')[0]
            .trim(),
        commitUrl: String(event.commit?.url ?? state.commitUrl),
        authorName: String(event.commit?.author?.name ?? event.user?.name ?? state.authorName),
        mergeRequest: event.merge_request
            ? {
                  iid: Number(event.merge_request.iid),
                  title: String(event.merge_request.title),
                  url: String(event.merge_request.url),
                  targetBranch: String(event.merge_request.target_branch),
              }
            : state.mergeRequest,
        pipelines: { ...state.pipelines, [String(attrs.id)]: snapshot },
        updatedAt: Date.now(),
    };
};

/**
 * Applies a `build` (job) hook.
 *
 * The old implementation dropped any job it had not already seen in a pipeline
 * payload, and dropped every job event that arrived before the first pipeline
 * event. Both cases are now upserted, so a job can never get stuck at
 * "pending" in the rendered card.
 */
const applyJobEvent = (current: CommitState | undefined, event: any): CommitState => {
    const projectId = Number(event.project_id);
    const sha = String(event.sha);
    const pipelineId = String(event.pipeline_id);
    const state = current ?? baseState(projectId, sha);
    const existing = state.pipelines[pipelineId];

    const job: Job = {
        id: Number(event.build_id),
        name: String(event.build_name),
        stage: String(event.build_stage),
        status: String(event.build_status) as JobStatus,
        allowFailure: Boolean(event.build_allow_failure),
        finishedAt: event.build_finished_at ? Date.parse(event.build_finished_at) : undefined,
    };

    const snapshot: PipelineSnapshot = existing
        ? {
              ...existing,
              jobs: { ...existing.jobs, [String(job.id)]: job },
              stages: existing.stages.includes(job.stage)
                  ? existing.stages
                  : [...existing.stages, job.stage],
              updatedAt: Date.now(),
          }
        : {
              id: Number(event.pipeline_id),
              source: 'unknown',
              status: 'running',
              stages: [job.stage],
              jobs: { [String(job.id)]: job },
              updatedAt: Date.now(),
          };

    return {
        ...state,
        ref: state.ref || String(event.ref ?? ''),
        projectName: state.projectName || String(event.project_name ?? ''),
        commitTitle:
            state.commitTitle ||
            String(event.commit?.message ?? '')
                .split('\n')[0]
                .trim(),
        authorName:
            state.authorName === 'unknown'
                ? String(event.commit?.author_name ?? event.user?.name ?? 'unknown')
                : state.authorName,
        pipelines: { ...state.pipelines, [pipelineId]: snapshot },
        updatedAt: Date.now(),
    };
};

export const gitlabWebhookRouter = (slackApp: App) => {
    const router = Router();

    router.post('/gitlab', verifyGitlabToken, async (req: Request, res: Response) => {
        const event = req.body;
        const objectKind = event?.object_kind;

        // Acknowledge before doing any work: GitLab times webhooks out at 10s,
        // and a slow Slack call must never turn into a redelivery.
        res.status(200).send('ok');

        try {
            if (objectKind === 'pipeline') {
                const projectId = Number(event.project.id);
                const sha = String(event.object_attributes.sha);
                const status = String(event.object_attributes.status);

                await updateCommitState(projectId, sha, (current) =>
                    applyPipelineEvent(current, event)
                );

                scheduleRender(
                    slackApp.client,
                    { projectId, sha },
                    { immediate: isTerminal(status) }
                );
            } else if (objectKind === 'build') {
                const projectId = Number(event.project_id);
                const sha = String(event.sha);
                const status = String(event.build_status);

                await updateCommitState(projectId, sha, (current) => applyJobEvent(current, event));

                // A failure is worth interrupting the debounce for; ordinary
                // job completions ride the next batched render.
                scheduleRender(
                    slackApp.client,
                    { projectId, sha },
                    { immediate: status === 'failed' }
                );
            } else {
                logger.debug('Ignoring webhook', { objectKind });
            }
        } catch (error) {
            logger.error('Failed to process webhook', error, {
                objectKind,
                projectId: event?.project?.id ?? event?.project_id,
            });
        }
    });

    return router;
};

export const __test = { applyPipelineEvent, applyJobEvent };
