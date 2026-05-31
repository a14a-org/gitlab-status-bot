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
