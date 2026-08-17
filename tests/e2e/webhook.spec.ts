import { expect, test } from "@playwright/test";
import { settle, slackCalls, startServer, stopServer, waitForCalls } from "./global-setup";

let baseURL = "";
const headers = { "X-Gitlab-Token": "test-secret" };

test.beforeAll(async () => {
	baseURL = await startServer();
});

test.afterAll(async () => {
	await stopServer();
});

test.beforeEach(() => {
	slackCalls.length = 0;
});

let shaCounter = 0;
const nextSha = () => `${(++shaCounter).toString().padStart(2, "0")}beef0b3511d1ad8437b987a965f8ca`;

const pipelineEvent = (sha: string, overrides: Record<string, any> = {}) => ({
	object_kind: "pipeline",
	object_attributes: {
		id: overrides.pipelineId ?? 555,
		sha,
		ref: overrides.ref ?? "master",
		source: overrides.source ?? "push",
		status: overrides.status ?? "running",
		stages: overrides.stages ?? ["build", "test"],
		url: "https://gitlab.example.com/p/555",
		duration: 90,
	},
	project: { id: 7, name: "demo-app" },
	commit: {
		id: sha,
		title: "fix: something small",
		url: `https://gitlab.example.com/c/${sha}`,
		author: { name: "Grace Hopper" },
	},
	builds: overrides.builds ?? [
		{ id: 1, name: "compile", stage: "build", status: "success", allow_failure: false },
		{ id: 2, name: "unit-tests", stage: "test", status: "running", allow_failure: false },
	],
	...(overrides.merge_request ? { merge_request: overrides.merge_request } : {}),
});

const jobEvent = (sha: string, overrides: Record<string, any> = {}) => ({
	object_kind: "build",
	sha,
	ref: overrides.ref ?? "master",
	project_id: 7,
	project_name: "demo-app",
	pipeline_id: overrides.pipelineId ?? 555,
	build_id: overrides.buildId ?? 2,
	build_name: overrides.buildName ?? "unit-tests",
	build_stage: overrides.buildStage ?? "test",
	build_status: overrides.buildStatus ?? "success",
	build_allow_failure: false,
	commit: { message: "fix: something small", author_name: "Grace Hopper" },
});

const post = (data: unknown, request: any) =>
	request.post(`${baseURL}/webhooks/gitlab`, { headers, data });

test("health endpoint reports healthy", async ({ request }) => {
	const res = await request.get(`${baseURL}/health`);
	expect(res.status()).toBe(200);
	expect((await res.json()).status).toBe("healthy");
});

test("rejects a webhook with a missing or wrong gitlab token", async ({ request }) => {
	const sha = nextSha();
	const noToken = await request.post(`${baseURL}/webhooks/gitlab`, { data: pipelineEvent(sha) });
	expect(noToken.status()).toBe(401);

	const wrongToken = await request.post(`${baseURL}/webhooks/gitlab`, {
		headers: { "X-Gitlab-Token": "nope" },
		data: pipelineEvent(sha),
	});
	expect(wrongToken.status()).toBe(401);
	await settle(100);
	expect(slackCalls).toHaveLength(0);
});

test("posts one card for a pipeline on a deploy branch", async ({ request }) => {
	const sha = nextSha();
	const res = await post(pipelineEvent(sha), request);
	expect(res.status()).toBe(200);

	const calls = await waitForCalls(1);
	expect(calls).toHaveLength(1);
	expect(calls[0].method).toBe("postMessage");
	expect(calls[0].args.channel).toBe("C123");
});

test("the push pipeline and its merge-request pipeline share one card", async ({ request }) => {
	const sha = nextSha();

	await post(pipelineEvent(sha, { pipelineId: 900, source: "push" }), request);
	await waitForCalls(1);

	await post(
		pipelineEvent(sha, {
			pipelineId: 901,
			source: "merge_request_event",
			ref: "master",
			merge_request: {
				iid: 42,
				title: "chore: bump the build cache",
				url: "https://gitlab.example.com/mr/42",
				target_branch: "master",
			},
		}),
		request,
	);
	await settle(300);

	const posts = slackCalls.filter((c) => c.method === "postMessage");
	expect(posts).toHaveLength(1);
	expect(slackCalls.filter((c) => c.method === "update").length).toBeGreaterThanOrEqual(1);
});

test("stays silent for a feature branch with no deploy stage", async ({ request }) => {
	const sha = nextSha();
	await post(pipelineEvent(sha, { ref: "feat/some-branch" }), request);
	await settle(250);
	expect(slackCalls).toHaveLength(0);
});

test("posts for a feature branch whose pipeline carries a deploy stage", async ({ request }) => {
	const sha = nextSha();
	await post(
		pipelineEvent(sha, {
			ref: "some-acc-branch",
			stages: ["build", "deploy_acc"],
			builds: [
				{ id: 3, name: "compile", stage: "build", status: "success", allow_failure: false },
				{
					id: 4,
					name: "deploy-acc",
					stage: "deploy_acc",
					status: "running",
					allow_failure: false,
				},
			],
		}),
		request,
	);
	const calls = await waitForCalls(1);
	expect(calls[0].method).toBe("postMessage");
});

test("a job event arriving before any pipeline event is not dropped", async ({ request }) => {
	const sha = nextSha();

	// Previously this was discarded outright, leaving the job invisible.
	await post(jobEvent(sha, { pipelineId: 700, buildId: 42, buildStatus: "failed" }), request);
	const calls = await waitForCalls(1);

	expect(calls[0].method).toBe("postMessage");
	expect(JSON.stringify(calls[0].args.blocks)).toContain("post_job_log_42");
});

test("coalesces a burst of job events into far fewer Slack calls", async ({ request }) => {
	const sha = nextSha();
	await post(pipelineEvent(sha, { pipelineId: 800 }), request);
	await waitForCalls(1);
	slackCalls.length = 0;

	// 20 job transitions delivered as one burst, as GitLab does on a real deploy.
	await Promise.all(
		Array.from({ length: 20 }, (_, i) =>
			post(
				jobEvent(sha, {
					pipelineId: 800,
					buildId: 100 + i,
					buildName: `job-${i}`,
					buildStage: "build",
					buildStatus: "success",
				}),
				request,
			),
		),
	);
	await settle(400);

	expect(slackCalls.filter((c) => c.method === "postMessage")).toHaveLength(0);
	// The old implementation issued one chat.update per event.
	expect(slackCalls.length).toBeLessThan(20);
});

test("a failed job renders immediately rather than waiting for the window", async ({ request }) => {
	const sha = nextSha();
	await post(pipelineEvent(sha, { pipelineId: 810 }), request);
	await waitForCalls(1);
	slackCalls.length = 0;

	await post(
		jobEvent(sha, { pipelineId: 810, buildId: 55, buildName: "e2e", buildStatus: "failed" }),
		request,
	);
	const calls = await waitForCalls(1, 300);
	expect(calls.length).toBeGreaterThanOrEqual(1);
	expect(JSON.stringify(calls[0].args.blocks)).toContain("post_job_log_55");
});
