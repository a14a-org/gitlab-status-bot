import type { App } from "@slack/bolt";
import express, { type Express } from "express";
import { gitlabWebhookRouter } from "../../src/webhooks/gitlab";

export interface SlackCall {
	method: "postMessage" | "update";
	args: Record<string, unknown>;
}

// Minimal in-memory Slack client stub so the webhook router can run without
// real Slack credentials. Records every call for assertions.
export const createSlackStub = (calls: SlackCall[]) =>
	({
		client: {
			chat: {
				postMessage: async (args: Record<string, unknown>) => {
					calls.push({ method: "postMessage", args });
					return { ok: true, ts: "1700000000.0001", channel: "C123" };
				},
				update: async (args: Record<string, unknown>) => {
					calls.push({ method: "update", args });
					return { ok: true };
				},
			},
		},
	}) as unknown as App;

export const createTestApp = (slackApp: App): Express => {
	const app = express();
	app.use(express.json());
	app.get("/health", (_req, res) => {
		res.status(200).json({ status: "healthy", timestamp: new Date().toISOString() });
	});
	app.use("/webhooks", gitlabWebhookRouter(slackApp));
	return app;
};
