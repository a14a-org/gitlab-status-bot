import { App } from '@slack/bolt';
import dotenv from 'dotenv';
import express from 'express';
import { assertRequiredEnv, config } from './config';
import { createErrorReportRouter } from './endpoints/errorReport';
import { registerSlackListeners } from './listeners/slackInteractions';
import { logger } from './logging';
import { flushPendingRenders } from './services/renderQueue';
import { cleanupOldStates } from './state/commitState';
import { gitlabWebhookRouter } from './webhooks/gitlab';

dotenv.config();
assertRequiredEnv();

const app = express();
const PORT = Number(process.env.PORT ?? 3000);

const slackApp = new App({
    token: config.slack.botToken(),
    signingSecret: config.slack.signingSecret(),
    socketMode: true,
    appToken: config.slack.appToken(),
});

registerSlackListeners(slackApp);

app.use(express.json({ limit: '2mb' }));

app.get('/health', (_req, res) => {
    res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version ?? '1.0.0',
    });
});

app.use('/webhooks', gitlabWebhookRouter(slackApp));
app.use('/reports/errors', createErrorReportRouter(slackApp));

/** Housekeeping sweep; the previous version never ran one. */
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
const cleanupTimer = setInterval(() => {
    cleanupOldStates().catch((error) => logger.error('State cleanup failed', error));
}, CLEANUP_INTERVAL_MS);
cleanupTimer.unref();

(async () => {
    try {
        await slackApp.start();
        logger.info('Slack Socket Mode connection established');

        app.listen(PORT, () => {
            logger.info('HTTP server listening', { port: PORT });
        });
    } catch (error) {
        logger.error('Failed to start the application', error);
        process.exit(1);
    }
})();

let shuttingDown = false;
const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('Shutting down', { signal });

    // Cloud Run gives ~10s after SIGTERM. Flush debounced renders so the final
    // pipeline status is not lost when the instance goes away.
    try {
        await flushPendingRenders(slackApp.client);
    } catch (error) {
        logger.error('Failed to flush pending renders on shutdown', error);
    }

    await slackApp.stop().catch(() => undefined);
    process.exit(0);
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', reason);
});
process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', error);
});
