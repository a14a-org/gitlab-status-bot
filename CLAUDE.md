# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development
- `npm install` - Install dependencies
- `npm start` - Run in development mode with hot-reload (uses ts-node-dev)
- `npm run build` - Compile TypeScript to JavaScript (outputs to dist/)

### Deployment
- Docker build: `docker build -t gitlab-status-bot .`
- Google Cloud deployment: Push to main branch triggers automatic Cloud Build

### Environment Setup
- Copy `.env.example` to `.env` and configure all required variables
- For local webhook testing, use ngrok to expose port 3000

## Architecture Overview

This is a GitLab CI/CD Status Bot for Slack built with TypeScript, designed for serverless deployment on Google Cloud Run with Firestore for state management.

### Key Components

1. **Express Server** (`src/index.ts`): Main entry point handling GitLab webhooks and health checks. Validates environment variables on startup.

2. **Slack Integration**: Uses Bolt framework in Socket Mode for real-time event handling without requiring a public URL. Interactive messages with expandable/collapsible pipeline stages.

3. **State Management** (`src/state/pipelineState.ts`): Google Cloud Firestore stores message timestamps and UI state (expanded stages). Enables serverless operation and scales across instances.

4. **GitLab Integration**: 
   - Webhook handler (`src/webhooks/gitlab.ts`) processes pipeline and job events
   - API client (`src/services/gitlabApi.ts`) fetches job logs on demand
   - Validates webhooks using shared secret

5. **Message Building** (`src/views/pipelineMessage.ts`): Creates Slack Block Kit messages with pipeline status, job details, and interactive elements.

### Project Structure
```
src/
├── index.ts              # Express server and app initialization
├── listeners/            # Slack interaction handlers
├── services/             # External API clients (GitLab)
├── state/                # Firestore state management
├── views/                # Slack message builders
└── webhooks/             # GitLab webhook processing
```

### Deployment Architecture
- **Docker**: Multi-stage build for minimal production image
- **Google Cloud Run**: Serverless deployment with auto-scaling (0-3 instances)
- **Firestore**: Serverless NoSQL database for persistent state
- **Cloud Build**: Automated CI/CD from main branch

### Important Notes
- No test framework configured yet
- No linting rules set up
- All sensitive configuration via environment variables
- Webhook validation prevents unauthorized requests
- Socket Mode eliminates need for public Slack webhook URL

### Test Summary Feature
The bot can parse and display test results from Jest output:
- Automatically detects test jobs by name patterns (test, jest, spec, unit, coverage)
- Shows test summary buttons (📊) for both successful and failed test jobs
- Displays formatted test results including:
  - Pass/fail counts for suites and tests
  - Coverage percentages with visual progress bars
  - Failed test details
  - Test file listing
- Test results are parsed from GitLab job logs on-demand