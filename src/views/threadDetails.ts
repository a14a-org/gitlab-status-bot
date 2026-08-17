import { KnownBlock } from '@slack/types';
import { CommitRollup } from '../domain/aggregate';
import { Job } from '../domain/types';
import { jobLine } from './commitCard';

const SLACK_SECTION_LIMIT = 2900;

/**
 * Full job breakdown, posted as a thread reply rather than expanded inline.
 * This is what replaced the per-stage show/hide buttons: the channel card stays
 * a fixed three blocks, and the detail lives one click away in the thread.
 */
export const buildDetailsBlocks = (rollup: CommitRollup): KnownBlock[] => {
    const blocks: KnownBlock[] = [];
    const byStage = new Map<string, Job[]>();

    for (const job of rollup.jobs) {
        const bucket = byStage.get(job.stage);
        if (bucket) {
            bucket.push(job);
        } else {
            byStage.set(job.stage, [job]);
        }
    }

    for (const stage of rollup.stages) {
        const jobs = byStage.get(stage.name) ?? [];
        if (jobs.length === 0) continue;

        jobs.sort((a, b) => a.name.localeCompare(b.name));

        // Failures first within a stage, so a 26-job build stage still leads
        // with the thing that broke.
        jobs.sort((a, b) => Number(b.status === 'failed') - Number(a.status === 'failed'));

        let body = '';
        for (const job of jobs) {
            const line = `${jobLine(job)}\n`;
            if (body.length + line.length > SLACK_SECTION_LIMIT) {
                blocks.push({ type: 'section', text: { type: 'mrkdwn', text: body.trimEnd() } });
                body = '';
            }
            body += line;
        }

        blocks.push({
            type: 'section',
            text: { type: 'mrkdwn', text: `*${stage.name}*\n${body.trimEnd()}` },
        });
    }

    return blocks.slice(0, 50);
};

/**
 * Job log as a thread reply. GitLab traces carry ANSI colour codes and section
 * markers that render as noise in Slack, so they are stripped here.
 */
export const buildJobLogBlocks = (jobName: string, rawLog: string, lines = 40): KnownBlock[] => {
    const cleaned = stripTraceNoise(rawLog);
    const tail = cleaned.split('\n').slice(-lines).join('\n');
    // 2900 leaves room for the code fence and the heading.
    const clipped = tail.length > 2700 ? `…${tail.slice(-2700)}` : tail;

    return [
        {
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: `*Log — ${jobName}* _(last ${lines} lines)_\n\`\`\`\n${clipped || 'empty log'}\n\`\`\``,
            },
        },
    ];
};

/** Strips ANSI escapes and GitLab's `section_start` / `section_end` markers. */
export const stripTraceNoise = (raw: string): string =>
    raw
        // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escapes are control characters by definition
        .replace(/\[[0-9;]*[a-zA-Z]/g, '')
        // biome-ignore lint/suspicious/noControlCharactersInRegex: GitLab delimits trace sections with \r and ESC[0K
        .replace(/section_(start|end):\d+:[^\r\n]*/g, '')
        .replace(/\r/g, '')
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .join('\n');
