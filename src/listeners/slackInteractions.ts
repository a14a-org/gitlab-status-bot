import { App } from '@slack/bolt';
import { KnownBlock } from '@slack/types';
import { rollUp } from '../domain/aggregate';
import { logger } from '../logging';
import { ErrorReportingService } from '../services/errorReporting';
import { getJobLog, getJobTestResults } from '../services/gitlabApi';
import { isTestJob } from '../services/testLogParser';
import { getCommitState, updateCommitState } from '../state/commitState';
import { formatErrorDetailsForSlack } from '../views/errorDetailsMessage';
import { buildTestSummaryReplacementBlock } from '../views/testSummaryMessage';
import { buildDetailsBlocks, buildJobLogBlocks } from '../views/threadDetails';

const parseValue = (raw: unknown): Record<string, any> => {
    try {
        return JSON.parse(String(raw));
    } catch {
        return {};
    }
};

/**
 * Posts a failed job's log as a thread reply.
 *
 * The previous handler spliced the log into the card in place of the actions
 * block, which permanently destroyed every other button on the message and made
 * the card grow without bound. Thread replies keep the channel card fixed.
 */
const postJobLog = async (args: any): Promise<void> => {
    const { ack, body, action, client } = args;
    await ack();

    const { jobId, name, sha } = parseValue(action.value);
    const channel = body.channel?.id;
    const threadTs = body.message?.thread_ts ?? body.message?.ts;

    if (!channel || !threadTs || !jobId) {
        logger.warn('Job log action missing message context', { jobId, sha });
        return;
    }

    try {
        const log = await getJobLog(Number(jobId));
        const blocks: KnownBlock[] = buildJobLogBlocks(String(name), log);

        // For test jobs the parsed failure summary is far more useful than the
        // raw tail, so lead with it and keep the log underneath.
        if (isTestJob(String(name))) {
            const results = await getJobTestResults(Number(jobId));
            if (results) {
                blocks.unshift(buildTestSummaryReplacementBlock(results, String(name)));
            }
        }

        await client.chat.postMessage({
            channel,
            thread_ts: threadTs,
            blocks,
            text: `Log for ${name}`,
        });

        const projectId = Number(process.env.GITLAB_PROJECT_ID);
        if (sha && Number.isFinite(projectId)) {
            await updateCommitState(projectId, String(sha), (current) =>
                current && !current.postedLogJobIds.includes(Number(jobId))
                    ? {
                          ...current,
                          postedLogJobIds: [...current.postedLogJobIds, Number(jobId)],
                          updatedAt: Date.now(),
                      }
                    : current
            );
        }

        logger.info('Posted job log to thread', { jobId, sha });
    } catch (error) {
        logger.error('Failed to post job log', error, { jobId, sha });
        await client.chat
            .postMessage({
                channel,
                thread_ts: threadTs,
                text: `Could not fetch the log for ${name}.`,
            })
            .catch(() => undefined);
    }
};

/** Posts the full per-stage job breakdown as a thread reply. */
const postCommitDetails = async (args: any): Promise<void> => {
    const { ack, body, action, client } = args;
    await ack();

    const { sha, projectId } = parseValue(action.value);
    const channel = body.channel?.id;
    const threadTs = body.message?.thread_ts ?? body.message?.ts;

    if (!channel || !threadTs || !sha) {
        logger.warn('Details action missing message context', { sha });
        return;
    }

    try {
        const state = await getCommitState(Number(projectId), String(sha));
        if (!state) {
            logger.warn('No state for details request', { sha });
            return;
        }

        await client.chat.postMessage({
            channel,
            thread_ts: threadTs,
            blocks: buildDetailsBlocks(rollUp(state)),
            text: 'Pipeline job breakdown',
        });

        logger.info('Posted commit details to thread', { sha });
    } catch (error) {
        logger.error('Failed to post commit details', error, { sha });
    }
};

/** Error-digest drill-down, posted by the Cloud Scheduler report. */
const viewErrorDetails = async (args: any): Promise<void> => {
    const { ack, body, action, client } = args;
    await ack();

    const errorGroupId = String(action.value);
    const channel = body.channel?.id;
    const threadTs = body.message?.thread_ts ?? body.message?.ts;
    const projectId = process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || '';

    if (!channel || !threadTs) {
        logger.warn('Error details action missing message context', { errorGroupId });
        return;
    }

    try {
        const details = await new ErrorReportingService(projectId).getErrorGroupDetails(
            errorGroupId
        );
        await client.chat.postMessage({
            channel,
            thread_ts: threadTs,
            text: formatErrorDetailsForSlack(details, projectId),
        });
    } catch (error) {
        logger.error('Failed to fetch error group details', error, { errorGroupId });
        await client.chat
            .postMessage({
                channel,
                thread_ts: threadTs,
                text: `Could not fetch details for error group \`${errorGroupId}\`. <https://console.cloud.google.com/errors/detail/${encodeURIComponent(errorGroupId)}?project=${projectId}|Open in Cloud Console>`,
            })
            .catch(() => undefined);
    }
};

export const registerSlackListeners = (app: App) => {
    app.action(/^post_job_log_/, postJobLog);
    app.action({ action_id: 'post_commit_details' }, postCommitDetails);
    app.action(/^view_error_/, viewErrorDetails);

    // Legacy action ids from the previous message format. Older cards are still
    // in channel history; acknowledge their buttons so Slack does not show a
    // "this app is not responding" warning on click.
    app.action(/^show_error_log/, async ({ ack }) => await ack());
    app.action(/^show_test_summary/, async ({ ack }) => await ack());
    app.action({ action_id: 'show_stage' }, async ({ ack }) => await ack());
    app.action({ action_id: 'hide_stage' }, async ({ ack }) => await ack());
    app.action({ action_id: 'view_console' }, async ({ ack }) => await ack());
    app.action({ action_id: 'configure_alerts' }, async ({ ack }) => await ack());
};
