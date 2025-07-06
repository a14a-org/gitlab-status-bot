# GitLab CI/CD Status Bot for Slack

This project is a Node.js/TypeScript application that provides rich, interactive, and real-time status updates for GitLab CI/CD pipelines directly within a Slack channel. It is designed to reduce channel noise by consolidating all pipeline updates into a single, dynamic message while providing easy access to detailed information.

**🚀 Serverless-Ready**: Built for Google Cloud Run with Firestore for state management, allowing the bot to scale to zero when idle and handle sporadic webhook traffic efficiently.

## Features

-   **Consolidated Status Message**: Instead of one message per job, the bot posts a single message for each pipeline and updates it in place.
-   **Real-Time Updates**: Subscribes to both pipeline and job events from GitLab to update the status of each job as it happens.
-   **Interactive UI**: Users can expand and collapse stages (e.g., lint, build, test) to see job details without cluttering the channel.
-   **At-a-Glance Summary**: Each stage is marked with an emoji (✅, ❌, ⚙️) indicating its overall status.
-   **Inline Error Logs**: If a job fails, a "Show Error Log" button appears, allowing users to view the last 20 lines of the job's log directly within Slack.
-   **Serverless Architecture**: Uses Google Cloud Firestore for persistent state, making it compatible with serverless environments like Cloud Run.

## How It Works

The application is built with a few key components:
-   **Express.js**: Runs a web server to listen for incoming webhook requests from GitLab.
-   **Slack Bolt for JS**: Manages all interaction with the Slack API, including posting/updating messages and handling button clicks via Socket Mode.
-   **Google Cloud Firestore**: Persistent state management that survives server restarts and scales with serverless deployments.
-   **GitLab API Integration**: Uses `axios` to make authenticated calls to the GitLab API to fetch job logs when requested.

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