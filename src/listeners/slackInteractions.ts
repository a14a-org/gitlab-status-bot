import { App } from '@slack/bolt';
import { KnownBlock } from '@slack/types';
import { getJobLog, getJobTestResults } from '../services/gitlabApi';
import { getPipelineState, setPipelineState } from '../state/pipelineState';
import { buildPipelineMessageBlocks } from '../views/pipelineMessage';
import { buildTestSummaryReplacementBlock } from '../views/testSummaryMessage';

// Handler for showing/hiding stage details
const toggleStageVisibility = async (args: any, show: boolean) => {
    const { ack, body, action, client } = args;
    await ack();

    try {
        const { stageName, pipelineId } = JSON.parse(action.value);
        const currentState = await getPipelineState(pipelineId);

        if (!currentState) return;

        // Update the set of expanded stages
        if (show) {
            currentState.expandedStages.add(stageName);
        } else {
            currentState.expandedStages.delete(stageName);
        }
        await setPipelineState(pipelineId, currentState);

        // Re-build and update the message
        const blocks = buildPipelineMessageBlocks(
            currentState.lastPipelineData,
            currentState.expandedStages
        );

        await client.chat.update({
            token: process.env.SLACK_BOT_TOKEN,
            channel: body.channel.id,
            ts: body.message.ts,
            blocks: blocks,
        });
    } catch (error) {
        console.error('Error toggling stage visibility:', error);
    }
};

// Using `any` here to bypass complex Bolt typing issues.
// The `args` object contains:
// - ack: A function to acknowledge the event.
// - body: The full request body from Slack.
// - action: The specific action payload (e.g., button click details).
// - client: The Slack Web API client.
const showErrorLogAction = async (args: any) => {
    const { ack, body, action, client } = args;

    await ack();
    const jobId = parseInt(action.value, 10);
    const originalMessage = body.message;

    if (!originalMessage?.ts || !body.channel?.id) {
        console.error('Could not find original message details to update.');
        return;
    }

    try {
        const errorLog = await getJobLog(jobId);
        const errorBlock: KnownBlock = {
            type: 'section',
            text: { type: 'mrkdwn', text: errorLog },
        };

        const originalBlocks = (originalMessage.blocks as KnownBlock[]) || [];
        const actionBlockIndex = originalBlocks.findIndex(
            (block) =>
                block.type === 'actions' &&
                (block.elements as any[]).some(
                    (el) => el.action_id === action.action_id && el.value === action.value
                )
        );

        if (actionBlockIndex !== -1) {
            originalBlocks.splice(actionBlockIndex, 1, errorBlock);
        }

        await client.chat.update({
            token: process.env.SLACK_BOT_TOKEN,
            channel: body.channel.id,
            ts: originalMessage.ts,
            blocks: originalBlocks,
        });
    } catch (error) {
        console.error('Failed to show error log', error);
    }
};

// Handler for showing test summary
const showTestSummaryAction = async (args: any) => {
    const { ack, body, action, client } = args;
    
    await ack();
    const { jobId, jobName } = JSON.parse(action.value);
    const originalMessage = body.message;

    if (!originalMessage?.ts || !body.channel?.id) {
        console.error('Could not find original message details to update.');
        return;
    }

    try {
        const testResults = await getJobTestResults(jobId);
        const summaryBlock = buildTestSummaryReplacementBlock(testResults, jobName);

        const originalBlocks = (originalMessage.blocks as KnownBlock[]) || [];
        const actionBlockIndex = originalBlocks.findIndex(
            (block) =>
                block.type === 'actions' &&
                (block.elements as any[]).some(
                    (el) => el.action_id === action.action_id && el.value === action.value
                )
        );

        if (actionBlockIndex !== -1) {
            originalBlocks.splice(actionBlockIndex, 1, summaryBlock);
        }

        await client.chat.update({
            token: process.env.SLACK_BOT_TOKEN,
            channel: body.channel.id,
            ts: originalMessage.ts,
            blocks: originalBlocks,
        });
    } catch (error) {
        console.error('Failed to show test summary', error);
    }
};

// Handler for viewing error details from error report
const viewErrorDetailsAction = async (args: any) => {
    const { ack, body, action, client } = args;
    
    await ack();
    const errorGroupId = action.value;
    
    // For now, just acknowledge the click. 
    // In a full implementation, you would fetch detailed error info from the API
    // and display it in a modal or thread
    console.log(`User requested details for error group: ${errorGroupId}`);
    
    // Post a message in thread with more details
    try {
        await client.chat.postMessage({
            channel: body.channel.id,
            thread_ts: body.message.ts,
            text: `🔍 Error details for group ${errorGroupId}:\n\nDetailed error information would be fetched from the Error Reporting API and displayed here. This feature is pending implementation.`,
        });
    } catch (error) {
        console.error('Failed to show error details:', error);
    }
};

// Handler for configure alerts button
const configureAlertsAction = async (args: any) => {
    const { ack } = args;
    await ack();
    console.log('User clicked configure alerts button');
};

export const registerSlackListeners = (app: App) => {
    // Use regex patterns to match dynamic action IDs
    app.action(/^show_error_log/, showErrorLogAction);
    app.action(/^show_test_summary/, showTestSummaryAction);
    app.action(/^view_error_/, viewErrorDetailsAction);
    app.action({ action_id: 'show_stage' }, (args) => toggleStageVisibility(args, true));
    app.action({ action_id: 'hide_stage' }, (args) => toggleStageVisibility(args, false));
    app.action({ action_id: 'configure_alerts' }, configureAlertsAction);
    app.action({ action_id: 'view_console' }, async ({ ack }) => await ack()); // Just acknowledge
};
