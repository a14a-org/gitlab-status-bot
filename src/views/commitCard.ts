import { Button, KnownBlock } from '@slack/types';
import { CommitRollup, StageRollup } from '../domain/aggregate';
import { CommitState, Job, JobStatus } from '../domain/types';

const OVERALL_EMOJI: Record<string, string> = {
    success: '🟢',
    failed: '🔴',
    running: '🟡',
    canceled: '⚫',
    pending: '⚪',
    created: '⚪',
};

const STAGE_EMOJI: Record<string, string> = {
    success: '✅',
    failed: '❌',
    running: '⚙️',
    canceled: '⚫',
    pending: '⏳',
    created: '⏳',
    skipped: '⏭️',
    manual: '⏸️',
};

export const formatDuration = (seconds: number): string => {
    if (!seconds || seconds < 1) return '—';
    const total = Math.round(seconds);
    const minutes = Math.floor(total / 60);
    const remainder = total % 60;
    if (minutes === 0) return `${remainder}s`;
    if (minutes < 60) return `${minutes}m${String(remainder).padStart(2, '0')}s`;
    return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}m`;
};

/** Slack renders raw `<`, `>` and `&` as markup; escape them in untrusted text. */
const escape = (text: string): string =>
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const truncate = (text: string, max: number): string =>
    text.length <= max ? text : `${text.slice(0, max - 1)}…`;

const stageLabel = (stage: StageRollup): string => {
    const emoji = STAGE_EMOJI[stage.status] ?? '❓';
    // Only show progress while the stage is mid-flight; a finished stage is
    // just a tick, which keeps the line short on 70-job master pipelines.
    if (stage.status === 'running' && stage.total > 0) {
        return `${emoji} ${stage.name} ${stage.done}/${stage.total}`;
    }
    if (stage.status === 'failed' && stage.failed > 0) {
        return `${emoji} ${stage.name} ${stage.failed}✗`;
    }
    return `${emoji} ${stage.name}`;
};

const headline = (state: CommitState, rollup: CommitRollup): string => {
    const emoji = OVERALL_EMOJI[rollup.status] ?? '⚪';
    const title = state.mergeRequest?.title ?? state.commitTitle;
    const link = state.mergeRequest?.url ?? state.commitUrl;
    const branch = escape(state.ref);
    const safeTitle = escape(truncate(title, 120));
    return `${emoji}  *${branch}* · <${link}|${safeTitle}>`;
};

const metaLine = (state: CommitState, rollup: CommitRollup): string => {
    const parts: string[] = [];
    parts.push(`<${state.commitUrl}|\`${state.sha.slice(0, 8)}\`>`);
    parts.push(`by ${escape(state.authorName)}`);

    if (rollup.durationSeconds > 0) {
        parts.push(formatDuration(rollup.durationSeconds));
    }

    for (const pipeline of rollup.pipelines) {
        const label = pipeline.source === 'merge_request_event' ? 'MR' : 'push';
        parts.push(pipeline.webUrl ? `<${pipeline.webUrl}|${label} ↗>` : label);
    }

    if (state.mergeRequest) {
        parts.push(`<${state.mergeRequest.url}|!${state.mergeRequest.iid}>`);
    }

    return parts.join(' · ');
};

/**
 * The channel-level card. Fixed at three blocks plus at most one action row, so
 * the message does not grow as the pipeline progresses — everything expandable
 * lives in the thread instead.
 */
export const buildCommitCard = (state: CommitState, rollup: CommitRollup): KnownBlock[] => {
    const blocks: KnownBlock[] = [
        {
            type: 'section',
            text: { type: 'mrkdwn', text: headline(state, rollup) },
        },
    ];

    if (rollup.stages.length > 0) {
        blocks.push({
            type: 'context',
            elements: [
                {
                    type: 'mrkdwn',
                    text: truncate(rollup.stages.map(stageLabel).join('  '), 2900),
                },
            ],
        });
    }

    blocks.push({
        type: 'context',
        elements: [{ type: 'mrkdwn', text: truncate(metaLine(state, rollup), 2900) }],
    });

    const buttons = buildActionButtons(state, rollup);
    if (buttons.length > 0) {
        blocks.push({ type: 'actions', elements: buttons });
    }

    return blocks;
};

const buildActionButtons = (state: CommitState, rollup: CommitRollup): Button[] => {
    const buttons: Button[] = [];

    // Failed job logs first — that is what anyone opens the message for.
    for (const job of rollup.failedJobs.slice(0, 4)) {
        buttons.push({
            type: 'button',
            text: { type: 'plain_text', text: `Log: ${truncate(job.name, 24)}`, emoji: true },
            style: 'danger',
            action_id: `post_job_log_${job.id}`,
            value: JSON.stringify({ jobId: job.id, name: job.name, sha: state.sha }),
        });
    }

    if (rollup.jobs.length > 0) {
        buttons.push({
            type: 'button',
            text: { type: 'plain_text', text: `Details (${rollup.jobs.length} jobs)`, emoji: true },
            action_id: 'post_commit_details',
            value: JSON.stringify({ sha: state.sha, projectId: state.projectId }),
        });
    }

    return buttons.slice(0, 5);
};

/** Fallback notification text — what shows in the sidebar and in push notifications. */
export const buildCardFallbackText = (state: CommitState, rollup: CommitRollup): string => {
    const title = state.mergeRequest?.title ?? state.commitTitle;
    return `${rollup.status}: ${state.ref} — ${truncate(title, 80)}`;
};

/** Detects whether a rendered card differs from the last one we sent. */
export const renderHash = (blocks: KnownBlock[]): string => JSON.stringify(blocks);

export const jobLine = (job: Job): string => {
    const emoji = STAGE_EMOJI[job.status as JobStatus] ?? '❓';
    const suffix = job.allowFailure && job.status === 'failed' ? ' _(allowed to fail)_' : '';
    return `${emoji} ${escape(job.name)}${suffix}`;
};
