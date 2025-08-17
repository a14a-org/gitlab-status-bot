import { Request, Response, Router } from 'express';
import { App } from '@slack/bolt';
import { ErrorAggregator } from '../services/errorAggregator';
import { buildErrorReportMessage } from '../views/errorReportMessage';

export function createErrorReportRouter(slackApp: App): Router {
    const router = Router();

    router.post('/trigger', async (req: Request, res: Response): Promise<void> => {
        try {
            // Verify the request is from Cloud Scheduler (optional but recommended)
            const authHeader = req.headers['authorization'];
            if (process.env.SCHEDULER_AUTH_TOKEN && authHeader !== `Bearer ${process.env.SCHEDULER_AUTH_TOKEN}`) {
                res.status(401).json({ error: 'Unauthorized' });
                return;
            }

            // Auto-detect project ID on Cloud Run, fallback to env var
            const projectId = process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
            if (!projectId) {
                throw new Error('GCP Project ID not found. Please set GCP_PROJECT_ID environment variable or run on Google Cloud.');
            }
            const channelId = process.env.ERROR_REPORT_CHANNEL_ID || process.env.SLACK_CHANNEL_ID;

            if (!channelId) {
                throw new Error('No Slack channel configured for error reports');
            }

            console.log('🔍 Generating daily error report...');

            // Generate the error report
            const aggregator = new ErrorAggregator(projectId);
            const report = await aggregator.generateDailyReport();

            // Build the Slack message
            const message = await buildErrorReportMessage(report, projectId);

            // Send to Slack
            await slackApp.client.chat.postMessage({
                channel: channelId,
                blocks: message.blocks,
                text: message.text,
            });

            console.log('✅ Daily error report sent successfully');

            res.status(200).json({
                success: true,
                message: 'Error report sent successfully',
                stats: {
                    totalErrors: report.summary.totalErrors,
                    errorGroups: report.summary.totalErrorGroups,
                    affectedServices: report.summary.affectedServices.length,
                },
            });
        } catch (error) {
            console.error('❌ Error generating daily report:', error);
            res.status(500).json({
                error: 'Failed to generate error report',
                details: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    });

    // Manual trigger endpoint (for testing)
    router.get('/trigger-manual', async (req: Request, res: Response): Promise<void> => {
        try {
            // This endpoint can be used for manual testing
            // In production, you might want to add additional auth checks
            
            // Auto-detect project ID on Cloud Run, fallback to env var
            const projectId = process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
            if (!projectId) {
                throw new Error('GCP Project ID not found. Please set GCP_PROJECT_ID environment variable or run on Google Cloud.');
            }
            const channelId = process.env.ERROR_REPORT_CHANNEL_ID || process.env.SLACK_CHANNEL_ID;

            if (!channelId) {
                throw new Error('No Slack channel configured for error reports');
            }

            console.log('🔍 Manually generating error report...');

            const aggregator = new ErrorAggregator(projectId);
            const report = await aggregator.generateDailyReport();

            const message = await buildErrorReportMessage(report, projectId);

            await slackApp.client.chat.postMessage({
                channel: channelId,
                blocks: message.blocks,
                text: message.text,
            });

            res.status(200).json({
                success: true,
                message: 'Manual error report sent successfully',
                stats: {
                    totalErrors: report.summary.totalErrors,
                    errorGroups: report.summary.totalErrorGroups,
                    affectedServices: report.summary.affectedServices.length,
                },
            });
        } catch (error) {
            console.error('❌ Error generating manual report:', error);
            res.status(500).json({
                error: 'Failed to generate error report',
                details: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    });

    // Health check for the error report endpoint
    router.get('/health', (req: Request, res: Response) => {
        res.status(200).json({
            status: 'healthy',
            endpoint: 'error-report',
            timestamp: new Date().toISOString(),
        });
    });

    return router;
}