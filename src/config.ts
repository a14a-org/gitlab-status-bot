import { logger } from './logging';

const REQUIRED_ENV_VARS = [
    'SLACK_BOT_TOKEN',
    'SLACK_APP_TOKEN',
    'SLACK_SIGNING_SECRET',
    'SLACK_CHANNEL_ID',
    'GITLAB_WEBHOOK_SECRET',
    'GITLAB_API_TOKEN',
    'GITLAB_PROJECT_ID',
    'GITLAB_BASE_URL',
] as const;

const csv = (value: string | undefined, fallback: string): string[] =>
    (value ?? fallback)
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);

const int = (value: string | undefined, fallback: number): number => {
    const parsed = Number.parseInt(value ?? '', 10);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const bool = (value: string | undefined, fallback: boolean): boolean => {
    if (value === undefined) return fallback;
    return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
};

export const assertRequiredEnv = (): void => {
    const missing = REQUIRED_ENV_VARS.filter((name) => !process.env[name]);
    if (missing.length > 0) {
        logger.error('Missing required environment variables', undefined, { missing });
        process.exit(1);
    }
};

export const config = {
    slack: {
        botToken: () => process.env.SLACK_BOT_TOKEN as string,
        appToken: () => process.env.SLACK_APP_TOKEN as string,
        signingSecret: () => process.env.SLACK_SIGNING_SECRET as string,
        channelId: () => process.env.SLACK_CHANNEL_ID as string,
    },

    gitlab: {
        webhookSecret: () => process.env.GITLAB_WEBHOOK_SECRET as string,
        projectId: () => process.env.GITLAB_PROJECT_ID as string,
        baseUrl: () => process.env.GITLAB_BASE_URL as string,
    },

    /**
     * Branches that always get a top-level card, regardless of what the
     * pipeline contains. Everything else has to earn a card by carrying a
     * deploy stage (see `deployStagePattern`).
     *
     * Deployment-specific branch names belong in the environment, not here.
     */
    deployBranches: (): string[] => csv(process.env.DEPLOY_BRANCHES, 'main,master'),

    /**
     * Any pipeline containing a stage matching this pattern is treated as a
     * deploying pipeline (e.g. `deploy_acc` / `deploy_prod`), so a branch
     * that starts deploying is picked up automatically without a config change.
     */
    deployStagePattern: (): RegExp => new RegExp(process.env.DEPLOY_STAGE_PATTERN ?? '^deploy'),

    /**
     * Post a card for non-deploying branches when their pipeline fails. Off by
     * default: a red feature branch is the author's problem, not the channel's.
     */
    postNonDeployFailures: (): boolean => bool(process.env.POST_NON_DEPLOY_FAILURES, false),

    /**
     * Intermediate progress updates are coalesced into one Slack call per
     * window. Terminal states bypass the debounce and render immediately.
     */
    updateDebounceMs: (): number => int(process.env.UPDATE_DEBOUNCE_MS, 4000),

    /** Commit state older than this is deleted by the cleanup sweep. */
    stateTtlDays: (): number => int(process.env.STATE_TTL_DAYS, 14),
} as const;
