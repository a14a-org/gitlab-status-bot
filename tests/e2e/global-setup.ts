import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createSlackStub, createTestApp, type SlackCall } from "./server";

export const slackCalls: SlackCall[] = [];
let server: Server | undefined;

export const startServer = async (): Promise<string> => {
	process.env.PIPELINE_STATE_BACKEND = "memory";
	process.env.GITLAB_WEBHOOK_SECRET = "test-secret";
	process.env.SLACK_BOT_TOKEN = "xoxb-test";
	process.env.SLACK_CHANNEL_ID = "C123";
	process.env.GITLAB_PROJECT_ID = "7";
	process.env.DEPLOY_BRANCHES = "master,main";
	// Keep the coalescing window short so tests stay fast but still exercise it.
	process.env.UPDATE_DEBOUNCE_MS = "25";

	const app = createTestApp(createSlackStub(slackCalls));
	server = createServer(app);
	await new Promise<void>((resolve) => server?.listen(0, resolve));
	const { port } = server?.address() as AddressInfo;
	return `http://127.0.0.1:${port}`;
};

export const stopServer = async (): Promise<void> => {
	await new Promise<void>((resolve, reject) =>
		server ? server.close((e) => (e ? reject(e) : resolve())) : resolve(),
	);
};

/**
 * The webhook acknowledges before rendering, so assertions have to wait for the
 * Slack call rather than assume it happened by the time the response landed.
 */
export const waitForCalls = async (count: number, timeoutMs = 3000): Promise<SlackCall[]> => {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (slackCalls.length >= count) break;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	return slackCalls;
};

/** Waits out the debounce window to prove no further call arrives. */
export const settle = async (ms = 200): Promise<void> => {
	await new Promise((resolve) => setTimeout(resolve, ms));
};
