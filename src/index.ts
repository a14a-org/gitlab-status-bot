import express from 'express';
import dotenv from 'dotenv';
import { App } from '@slack/bolt';
import { gitlabWebhookRouter } from './webhooks/gitlab';
import { registerSlackListeners } from './listeners/slackInteractions';

// Load environment variables from .env file
dotenv.config();

// Validate required environment variables
const requiredEnvVars = [
    'SLACK_BOT_TOKEN',
    'SLACK_APP_TOKEN', 
    'SLACK_SIGNING_SECRET',
    'SLACK_CHANNEL_ID',
    'GITLAB_WEBHOOK_SECRET',
    'GITLAB_API_TOKEN',
    'GITLAB_PROJECT_ID',
    'GITLAB_BASE_URL'
];

const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingEnvVars.length > 0) {
    console.error('❌ Missing required environment variables:', missingEnvVars.join(', '));
    console.error('Please check your .env file and ensure all required variables are set.');
    process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Slack App
const slackApp = new App({
    token: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    socketMode: true,
    appToken: process.env.SLACK_APP_TOKEN,
});

// Register Slack action listeners
registerSlackListeners(slackApp);

// Middleware to parse incoming JSON payloads
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || '1.0.0'
    });
});

// Register our webhook router, passing the slack app instance
app.use('/webhooks', gitlabWebhookRouter(slackApp));

(async () => {
    try {
        // Start the Slack app
        await slackApp.start();
        console.log('⚡️ Bolt app is running!');

        // Start the Express server
        app.listen(PORT, () => {
            console.log(`🚀 Express server is listening on port ${PORT}`);
            console.log(`📊 Health check available at http://localhost:${PORT}/health`);
        });
    } catch (error) {
        console.error('❌ Failed to start the application:', error);
        process.exit(1);
    }
})();

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('📴 Received SIGTERM, shutting down gracefully...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('📴 Received SIGINT, shutting down gracefully...');
    process.exit(0);
});
