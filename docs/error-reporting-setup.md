# Error Reporting Setup Guide

This guide explains how to set up daily error reporting from Google Cloud Error Reporting to Slack.

## Overview

The GitLab Status Bot can send daily aggregated error reports from Google Cloud Error Reporting to your Slack channel. These reports include:
- Total error counts and trends
- Top errors by severity
- Service-level error distribution
- 24-hour error timeline
- Direct links to Cloud Console for detailed investigation

## Prerequisites

1. The bot must be deployed to Google Cloud Run
2. The Cloud Run service account needs the following permissions:
   - `roles/errorreporting.viewer` - To read error data
   - `roles/datastore.user` - To store report history (already granted if using Firestore)

## Configuration

### Environment Variables

Add the following optional environment variables:

```bash
# Slack channel for error reports (optional - defaults to SLACK_CHANNEL_ID)
ERROR_REPORT_CHANNEL_ID=C1234567890

# Security token for Cloud Scheduler (recommended)
SCHEDULER_AUTH_TOKEN=your-random-secure-token-here
```

### Setting up Cloud Scheduler

1. **Enable Cloud Scheduler API**:
   ```bash
   gcloud services enable cloudscheduler.googleapis.com
   ```

2. **Create a service account for Cloud Scheduler** (if not using default):
   ```bash
   gcloud iam service-accounts create error-report-scheduler \
     --display-name="Error Report Scheduler"
   ```

3. **Grant the service account permission to invoke Cloud Run**:
   ```bash
   gcloud run services add-iam-policy-binding gitlab-status-bot \
     --member="serviceAccount:error-report-scheduler@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
     --role="roles/run.invoker" \
     --region=YOUR_REGION
   ```

4. **Create the Cloud Scheduler job**:
   ```bash
   gcloud scheduler jobs create http daily-error-report \
     --location=YOUR_REGION \
     --schedule="0 8 * * *" \
     --time-zone="Europe/Berlin" \
     --uri="https://YOUR-CLOUD-RUN-URL/reports/errors/trigger" \
     --http-method=POST \
     --oidc-service-account-email="error-report-scheduler@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
     --headers="Authorization=Bearer YOUR_SCHEDULER_AUTH_TOKEN" \
     --attempt-deadline="10m"
   ```

   Replace:
   - `YOUR_PROJECT_ID` with your GCP project ID
   - `YOUR_REGION` with your Cloud Run region (e.g., `europe-west1`)
   - `YOUR-CLOUD-RUN-URL` with your Cloud Run service URL
   - `YOUR_SCHEDULER_AUTH_TOKEN` with the token from your environment variables

   The schedule `"0 8 * * *"` runs daily at 8:00 AM CEST.

## Testing

### Manual Trigger

You can manually trigger an error report for testing:

```bash
curl https://YOUR-CLOUD-RUN-URL/reports/errors/trigger-manual
```

This endpoint is useful for:
- Verifying the integration works correctly
- Testing message formatting
- Debugging permission issues

### Verify Permissions

Check that your Cloud Run service account has the necessary permissions:

```bash
gcloud projects get-iam-policy YOUR_PROJECT_ID \
  --flatten="bindings[].members" \
  --format="table(bindings.role)" \
  --filter="bindings.members:YOUR-SERVICE-ACCOUNT@YOUR_PROJECT_ID.iam.gserviceaccount.com"
```

## Slack Message Format

The daily error report includes:

1. **Header**: Date and time of the report
2. **Summary**: Total errors, trends, affected services
3. **Critical Errors**: High-priority errors requiring immediate attention
4. **Top Errors**: Most frequent errors by occurrence
5. **Service Distribution**: Visual breakdown of errors by service
6. **24-Hour Timeline**: Sparkline showing error distribution over time
7. **Actions**: Links to Cloud Console and configuration options

## Troubleshooting

### No Errors Appearing

1. Verify the service account has `roles/errorreporting.viewer` permission
2. Check that errors are being logged to Error Reporting in Cloud Console
3. Ensure the project ID is correct (check Cloud Run logs)

### Authentication Errors

1. If running locally, ensure you have `gcloud auth application-default login`
2. On Cloud Run, verify the service account permissions
3. Check that the metadata service is accessible

### Scheduler Not Triggering

1. Verify the Cloud Scheduler job is enabled
2. Check the Cloud Scheduler logs for errors
3. Ensure the OIDC service account has `roles/run.invoker` permission

## Customization

### Adjusting Report Frequency

Modify the Cloud Scheduler cron expression:
- Daily at 8 AM: `"0 8 * * *"`
- Twice daily (8 AM and 6 PM): `"0 8,18 * * *"`
- Weekly on Mondays: `"0 8 * * 1"`

### Filtering Errors

You can customize which errors are included by modifying `src/services/errorAggregator.ts`:
- Filter by service
- Exclude certain error types
- Adjust severity thresholds

### Channel Routing

Set different channels for different severity levels by modifying the endpoint logic in `src/endpoints/errorReport.ts`.