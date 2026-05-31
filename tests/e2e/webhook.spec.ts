import { expect, test } from "@playwright/test";
import { slackCalls, startServer, stopServer } from "./global-setup";

let baseURL = "";

test.beforeAll(async () => {
	baseURL = await startServer();
});

test.afterAll(async () => {
	await stopServer();
});

test.beforeEach(() => {
	slackCalls.length = 0;
});

const pipelineEvent = {
	object_kind: "pipeline",
	object_attributes: { id: 555, ref: "main", stages: ["build", "test"] },
	project: { name: "demo" },
	commit: {
		id: "deadbeefcafe",
		url: "https://gitlab.example.com/c/deadbeefcafe",
		author: { name: "Grace Hopper" },
	},
	builds: [
		{ id: 1, name: "compile", stage: "build", status: "success" },
		{ id: 2, name: "unit-tests", stage: "test", status: "running" },
	],
};

test("health endpoint reports healthy", async ({ request }) => {
	const res = await request.get(`${baseURL}/health`);
	expect(res.status()).toBe(200);
	const body = await res.json();
	expect(body.status).toBe("healthy");
	expect(typeof body.timestamp).toBe("string");
});

test("rejects webhook with a missing or wrong gitlab token", async ({ request }) => {
	const noToken = await request.post(`${baseURL}/webhooks/gitlab`, { data: pipelineEvent });
	expect(noToken.status()).toBe(401);

	const wrongToken = await request.post(`${baseURL}/webhooks/gitlab`, {
		headers: { "X-Gitlab-Token": "nope" },
		data: pipelineEvent,
	});
	expect(wrongToken.status()).toBe(401);
	expect(slackCalls).toHaveLength(0);
});

test("accepts a valid pipeline webhook and posts a new Slack message", async ({ request }) => {
	const res = await request.post(`${baseURL}/webhooks/gitlab`, {
		headers: { "X-Gitlab-Token": "test-secret" },
		data: pipelineEvent,
	});
	expect(res.status()).toBe(200);
	expect(slackCalls).toHaveLength(1);
	expect(slackCalls[0].method).toBe("postMessage");
	expect(slackCalls[0].args.channel).toBe("C123");
	expect(Array.isArray(slackCalls[0].args.blocks)).toBe(true);
});

test("updates the existing Slack message on a repeated pipeline event", async ({ request }) => {
	const headers = { "X-Gitlab-Token": "test-secret" };
	await request.post(`${baseURL}/webhooks/gitlab`, { headers, data: pipelineEvent });
	const second = await request.post(`${baseURL}/webhooks/gitlab`, {
		headers,
		data: pipelineEvent,
	});
	expect(second.status()).toBe(200);
	expect(slackCalls.map((c) => c.method)).toEqual(["postMessage", "update"]);
	expect(slackCalls[1].args.ts).toBe("1700000000.0001");
});
