# GitLab CI/CD Status Bot for Slack

This project is a Node.js/TypeScript application that reports GitLab CI/CD pipeline status into a Slack channel. It posts **one card per commit** and updates that card in place, so a deploy reads as a single line of channel history instead of a stream of messages.

## What the card looks like

```
🟡  main · fix: correct the widget total on the summary page
    ✅ prepare  ✅ test  ✅ pre_build  ⚙️ build 12/26  ⏳ deploy_staging  ⏳ deploy_prod
    9f8c0d2a · by Ada Lovelace · 8m14s · push ↗ · MR ↗ · !42
    [Log: build-job-23]  [Details (72 jobs)]
```

The card is a fixed four blocks whether the pipeline has 2 jobs or 72. Everything expandable — the full per-stage job breakdown, failed job logs, parsed test summaries — is posted as a **thread reply**, so the channel stays readable.

## Features

-   **One card per commit.** A push pipeline and its detached merge-request pipeline share a commit SHA, so they share a card rather than producing two messages. Both pipelines are linked from the card's meta line.
-   **Only pipelines that matter.** A commit gets a card when its branch is on `DEPLOY_BRANCHES`, or when any of its pipelines actually contains a deploy stage. Ordinary feature-branch runs stay out of the channel.
-   **Coalesced updates.** A large monorepo deploy emits over 200 job transitions. Those are batched into one Slack call per window (`UPDATE_DEBOUNCE_MS`, default 4s), with failures and terminal states rendering immediately. In practice ~60 job events produce ~5 Slack calls instead of 61.
-   **Transactional state.** GitLab delivers webhooks in bursts, so every state change runs inside a Firestore transaction. Job statuses cannot clobber each other.
-   **Structured logging.** Every log line is JSON on stdout, which Cloud Logging promotes to `jsonPayload` with a real severity.

## How It Works

-   **Express.js** receives GitLab pipeline and job webhooks, acknowledges them immediately, then processes asynchronously (GitLab times webhooks out at 10s).
-   **Firestore** holds one document per commit, keyed `<projectId>_<sha>`, updated transactionally. Documents past `STATE_TTL_DAYS` are swept periodically.
-   **The render queue** debounces and coalesces card updates, and serialises work per commit so a burst cannot post two cards for the same commit.
-   **Slack Bolt** posts and updates the card and handles button clicks over Socket Mode.
-   **GitLab API** is called via `axios` to fetch job traces on demand.

### Operational constraints

Socket Mode holds a persistent WebSocket, so the service needs `--no-cpu-throttling` for the connection to survive between requests. That combination keeps the instance alive continuously — measured at 24 billable instance-hours per day — so the service is effectively always-on even with `min-instances=0`. Setting `--min-instances=1` costs nothing extra and closes the few-second window while a recycled instance restarts.

The render queue debounces in process, so the service must stay at `--max-instances=1`. Scaling out would require moving the debounce behind a shared lock.

Because the instance never sleeps, the always-allocated CPU is billed around the clock. Moving interactivity from Socket Mode to an HTTP endpoint would allow CPU throttling and genuine scale-to-zero, which is the main cost lever available here.

---

## Getting Started

Follow these steps to set up and run the bot in a development environment.

### Prerequisites

-   [Node.js](https://nodejs.org/) (v16 or higher)
-   A Slack workspace where you have permission to install apps.
-   A GitLab project where you have permission to configure webhooks.
-   **For local development**: [ngrok](https://ngrok.com/) to expose your local server to the internet for GitLab webhooks.
-   **For production**: A Google Cloud Project with Firestore enabled.

### 1. Installation

Clone the repository and install the dependencies:

```bash
git clone https://github.com/a14a-org/gitlab-status-bot.git
cd gitlab-status-bot
npm install
```

### 2. Slack App Setup

The easiest way to configure the Slack app is by using the provided manifest.

1.  Navigate to the [Slack App creation page](https://api.slack.com/apps/new) and select **"From an app manifest"**.
2.  Choose your workspace.
3.  Copy the entire content of the `manifest.json` file from this project and paste it into the JSON tab.
4.  Click **Next**, review the configuration, and click **Create**.
5.  On the next page, click **Install to Workspace** and allow the requested permissions.

### 3. Google Cloud Setup (Required for Production)

If you're deploying to production or want to test with persistent state:

1.  Create a Google Cloud Project or use an existing one.
2.  Enable the Firestore API in your project.
3.  Create a Firestore database in Native mode.
4.  If running locally, install the [Google Cloud SDK](https://cloud.google.com/sdk) and run `gcloud auth application-default login`.

### 4. GitLab Webhook Setup

1.  In your GitLab project, go to **Settings > Webhooks**.
2.  Click **Add new webhook**.
3.  **URL**: 
    - **Local development**: Start `ngrok` to get a public URL (`ngrok http 3000`). Use: `https://<your-ngrok-url>.ngrok-free.app/webhooks/gitlab`
    - **Cloud Run**: Use your Cloud Run service URL: `https://your-service-url.run.app/webhooks/gitlab`
4.  **Secret token**: Create a strong, random string and enter it here. You will add this same string to your environment variables.
5.  **Trigger**: Select the following two events:
    -   ✅ **Pipeline events**
    -   ✅ **Job events**
6.  Click **Add webhook**.

### 5. Environment Configuration

The application uses environment variables for all secrets and configuration.

1.  Copy the example environment file:
    ```bash
    cp .env.example .env
    ```
2.  Open the newly created `.env` file and fill in the values. See the comments in the file for detailed instructions on where to find each token and ID.

#### Behaviour tuning

All optional:

| Variable | Default | Purpose |
|---|---|---|
| `DEPLOY_BRANCHES` | `main,master` | Branches that always get a card. Other deploying branches are picked up automatically by the rule below. |
| `DEPLOY_STAGE_PATTERN` | `^deploy` | Any pipeline containing a matching stage gets a card, whatever its branch, so a new deploying branch is picked up without a config change. |
| `POST_NON_DEPLOY_FAILURES` | `false` | Also post when a non-deploying branch fails. |
| `UPDATE_DEBOUNCE_MS` | `4000` | Coalescing window for progress updates. Failures and terminal states ignore it. |
| `STATE_TTL_DAYS` | `14` | Age at which commit state is swept from Firestore. |
| `PIPELINE_STATE_BACKEND` | *(unset)* | Set to `memory` for a hermetic, Firestore-free run. Used by the test suite. |

⚠️ **Security Notice**: Never commit your `.env` file or any files containing secrets to version control. The `.gitignore` file is configured to prevent this, but always double-check before committing.

### 6. Running the Bot

#### Development Mode

Once your `.env` file is configured, you can start the server:

```bash
npm start
```

The server will connect to Slack via Socket Mode and begin listening for webhook events from GitLab on port 3000. Trigger a pipeline in your GitLab project to see the bot in action.

#### Production Mode with Docker

For production deployment, you can use Docker:

```bash
# Build the Docker image
docker build -t gitlab-status-bot .

# Run the container with environment variables
docker run -d \
  --name gitlab-status-bot \
  -p 3000:3000 \
  --env-file .env \
  gitlab-status-bot
```

#### Production Mode with Google Cloud Run

For serverless deployment on Google Cloud Run:

1.  **Set up Google Cloud Build**: Connect your GitHub repository to Cloud Build.
2.  **Configure environment variables**: In Cloud Run, set all the required environment variables from your `.env.example`.
3.  **Deploy**: Push to your main branch to trigger automatic deployment via the included `cloudbuild.yaml`.

The application includes a health check endpoint at `/health` for monitoring.

## Project Structure

-   `src/index.ts`: The main application entry point. Initializes the Express server and Slack Bolt app.
-   `src/webhooks/`: Contains the Express router for handling incoming GitLab webhooks.
-   `src/views/`: Logic for building the dynamic Slack Block Kit UI.
-   `src/state/`: Firestore-based state management for tracking message timestamps and UI state.
-   `src/listeners/`: Handlers for Slack interactivity (button clicks).
-   `src/services/`: Client for interacting with external APIs (e.g., GitLab API).
-   `manifest.json`: Configuration file for easy Slack App setup.
-   `.env.example`: A template for the required environment variables.
-   `Dockerfile`: Container configuration for production deployment.
-   `cloudbuild.yaml`: Google Cloud Build configuration for automated deployment.

## Architecture

### Serverless State Management

This bot uses Google Cloud Firestore to maintain state across serverless function invocations. This allows:

-   **Zero-cost idle time**: The bot scales to zero when not receiving webhooks
-   **Persistent state**: Message state survives server restarts and cold starts
-   **Multi-instance support**: Multiple concurrent instances can safely share state
-   **Automatic cleanup**: Optional cleanup functions to remove old pipeline data

### Scaling Configuration

The included Cloud Run configuration is optimized for low-frequency webhook traffic:

-   **Min instances**: 0 (scales to zero when idle)
-   **Max instances**: 3 (handles traffic spikes)
-   **Memory**: 512Mi (sufficient for the lightweight application)
-   **CPU**: 1 (adequate for webhook processing)

## Troubleshooting

### Common Issues

**Bot posts "not_in_channel" error**
- Solution: Invite the bot to your target Slack channel by mentioning it (`@GitLab Status`) and clicking "Invite them".

**GitLab webhook returns 404 Not Found**
- Solution: Ensure your webhook URL includes the full path: `https://your-service-url/webhooks/gitlab`

**"no more than 50 items allowed" error**
- This has been resolved in the current version. If you see this error, ensure you're using the latest code that groups jobs by stage.

**Bot doesn't update when jobs complete**
- Solution: Make sure both "Pipeline events" and "Job events" are enabled in your GitLab webhook configuration.

**Environment variable errors on startup**
- Solution: Verify all required variables in your environment are set. Check `.env.example` for the complete list.

**Firestore permission errors**
- Solution: Ensure your Google Cloud project has Firestore enabled and your service account has the necessary permissions.

### Getting Help

If you encounter issues not covered here:
1. Check the server logs for detailed error messages
2. Verify your GitLab webhook is receiving successful responses (200 OK)
3. Test your Slack app permissions by trying to post a message manually
4. For Cloud Run deployments, check the Cloud Run logs in the Google Cloud Console
5. Open an issue on this repository with relevant logs and configuration details

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request. 