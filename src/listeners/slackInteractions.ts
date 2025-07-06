import { App } from '@slack/bolt';
import { KnownBlock } from '@slack/types';
import { getJobLog } from '../services/gitlabApi';
import { getPipelineState, setPipelineState } from '../state/pipelineState';
import { buildPipelineMessageBlocks } from '../views/pipelineMessage';

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
                    (el) => el.action_id === 'show_error_log' && el.value === action.value
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

export const registerSlackListeners = (app: App) => {
    app.action({ action_id: 'show_error_log' }, showErrorLogAction);
    app.action({ action_id: 'show_stage' }, (args) => toggleStageVisibility(args, true));
    app.action({ action_id: 'hide_stage' }, (args) => toggleStageVisibility(args, false));
};
