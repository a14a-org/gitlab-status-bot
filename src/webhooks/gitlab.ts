import { Request, Response, NextFunction, Router } from 'express';
import { App } from '@slack/bolt';
import { getPipelineState, setPipelineState } from '../state/pipelineState';
import { buildPipelineMessageBlocks } from '../views/pipelineMessage';

const verifyGitlabToken = (req: Request, res: Response, next: NextFunction): void => {
    const gitlabToken = req.header('X-Gitlab-Token');
    if (gitlabToken !== process.env.GITLAB_WEBHOOK_SECRET) {
        console.error('Invalid GitLab token');
        res.status(401).send('Unauthorized');
        return;
    }
    next();
};

export const gitlabWebhookRouter = (slackApp: App) => {
    const router = Router();

    router.post('/gitlab', verifyGitlabToken, async (req: Request, res: Response) => {
        const event = req.body;
        const objectKind = event.object_kind;

        try {
            if (objectKind === 'pipeline') {
                const pipelineId = event.object_attributes.id;
                const existingMessage = getPipelineState(pipelineId);
                const blocks = buildPipelineMessageBlocks(
                    event,
                    existingMessage?.expandedStages || new Set()
                );

                if (existingMessage) {
                    await slackApp.client.chat.update({
                        token: process.env.SLACK_BOT_TOKEN,
                        channel: existingMessage.channel,
                        ts: existingMessage.ts,
                        blocks: blocks,
                        text: 'Pipeline status updated.',
                    });
                    setPipelineState(pipelineId, {
                        ...existingMessage,
                        lastPipelineData: event,
                    });
                } else {
                    const result = await slackApp.client.chat.postMessage({
                        token: process.env.SLACK_BOT_TOKEN,
                        channel: process.env.SLACK_CHANNEL_ID!,
                        blocks: blocks,
                        text: 'New pipeline started.',
                    });
                    if (result.ok && result.ts && result.channel) {
                        setPipelineState(pipelineId, {
                            ts: result.ts,
                            channel: result.channel,
                            expandedStages: new Set(),
                            lastPipelineData: event,
                        });
                    }
                }
            } else if (objectKind === 'build') {
                const pipelineId = event.pipeline_id;
                const buildId = event.build_id;
                const currentState = getPipelineState(pipelineId);

                if (currentState) {
                    const buildToUpdate = currentState.lastPipelineData.builds.find(
                        (b: any) => b.id === buildId
                    );
                    if (buildToUpdate) {
                        buildToUpdate.status = event.build_status;
                    }
                    setPipelineState(pipelineId, currentState);

                    const blocks = buildPipelineMessageBlocks(
                        currentState.lastPipelineData,
                        currentState.expandedStages
                    );

                    await slackApp.client.chat.update({
                        token: process.env.SLACK_BOT_TOKEN,
                        channel: currentState.channel,
                        ts: currentState.ts,
                        blocks: blocks,
                        text: 'Pipeline status updated.',
                    });
                }
            }
        } catch (error) {
            console.error('Error processing webhook:', error);
        }

        res.status(200).send('Webhook received and processed');
    });

    return router;
};
