import { expect, test } from "@playwright/test";
import { rollUp } from "../../src/domain/aggregate";
import type { CommitState, Job, PipelineSnapshot } from "../../src/domain/types";
import { buildCommitCard, formatDuration } from "../../src/views/commitCard";

type Block = {
	type: string;
	text?: { text?: string };
	elements?: Array<{ action_id?: string; text?: { text?: string } }>;
};

const job = (id: number, name: string, stage: string, status: string): Job =>
	({ id, name, stage, status, allowFailure: false }) as Job;

const state = (jobs: Job[], stages: string[], extra: Partial<CommitState> = {}): CommitState => ({
	projectId: 7,
	sha: "9f8c0d2a1b3e4f5a6b7c8d9e0f1a2b3c4d5e6f70",
	ref: "master",
	projectName: "demo-app",
	commitTitle: "fix: correct the widget total",
	commitUrl: "https://gitlab.example.com/c/9f8c0d2a",
	authorName: "Ada Lovelace",
	pipelines: {
		"1": {
			id: 1,
			source: "push",
			status: "running",
			stages,
			jobs: Object.fromEntries(jobs.map((j) => [String(j.id), j])),
			webUrl: "https://gitlab.example.com/p/1",
			durationSeconds: 134,
			updatedAt: 0,
		} as PipelineSnapshot,
	},
	postedLogJobIds: [],
	detailsPosted: false,
	createdAt: 0,
	updatedAt: 0,
	...extra,
});

const card = (s: CommitState) => buildCommitCard(s, rollUp(s)) as Block[];

test.describe("buildCommitCard", () => {
	test("stays compact regardless of how many jobs the pipeline has", () => {
		const few = card(state([job(1, "a", "build", "running")], ["build"]));
		const many = card(
			state(
				Array.from({ length: 72 }, (_, i) => job(i + 1, `job-${i}`, "build", "running")),
				["build"],
			),
		);
		expect(few.length).toBe(many.length);
		expect(many.length).toBeLessThanOrEqual(4);
	});

	test("headline carries the branch, status colour and commit title", () => {
		const blocks = card(state([job(1, "a", "build", "running")], ["build"]));
		expect(blocks[0].type).toBe("section");
		expect(blocks[0].text?.text).toContain("*master*");
		expect(blocks[0].text?.text).toContain("🟡");
		expect(blocks[0].text?.text).toContain("correct the widget total");
	});

	test("prefers the merge-request title over the commit title", () => {
		const blocks = card(
			state([job(1, "a", "build", "running")], ["build"], {
				mergeRequest: {
					iid: 42,
					title: "chore: bump the build cache",
					url: "https://gitlab.example.com/mr/42",
					targetBranch: "master",
				},
			}),
		);
		expect(blocks[0].text?.text).toContain("build cache");
		expect(JSON.stringify(blocks)).toContain("!42");
	});

	test("shows progress only for the stage that is running", () => {
		const blocks = card(
			state(
				[
					job(1, "a", "lint", "success"),
					job(2, "b", "build", "running"),
					job(3, "c", "build", "success"),
					job(4, "d", "test", "created"),
				],
				["lint", "build", "test"],
			),
		);
		const stageLine = blocks[1].elements?.[0] as unknown as { text: string };
		expect(stageLine.text).toContain("✅ lint");
		expect(stageLine.text).toContain("⚙️ build 1/2");
		expect(stageLine.text).toContain("⏳ test");
		expect(stageLine.text).not.toContain("lint 1/1");
	});

	test("offers a log button per failed job plus a details button", () => {
		const blocks = card(
			state(
				[job(1, "unit", "test", "failed"), job(2, "lint", "lint", "success")],
				["lint", "test"],
			),
		);
		const actions = blocks.find((b) => b.type === "actions");
		const ids = (actions?.elements ?? []).map((e) => e.action_id);
		expect(ids).toContain("post_job_log_1");
		expect(ids).toContain("post_commit_details");
	});

	test("never exceeds Slack's five-element action row", () => {
		const blocks = card(
			state(
				Array.from({ length: 12 }, (_, i) => job(i + 1, `job-${i}`, "test", "failed")),
				["test"],
			),
		);
		const actions = blocks.find((b) => b.type === "actions");
		expect((actions?.elements ?? []).length).toBeLessThanOrEqual(5);
	});

	test("escapes Slack markup in untrusted commit titles", () => {
		const blocks = card(
			state([job(1, "a", "build", "running")], ["build"], {
				commitTitle: "fix: <script> & <https://evil|click>",
			}),
		);
		expect(blocks[0].text?.text).toContain("&lt;script&gt;");
		expect(blocks[0].text?.text).not.toContain("<script>");
	});
});

test.describe("formatDuration", () => {
	test("renders seconds, minutes and hours", () => {
		expect(formatDuration(0)).toBe("—");
		expect(formatDuration(45)).toBe("45s");
		expect(formatDuration(134)).toBe("2m14s");
		expect(formatDuration(3700)).toBe("1h01m");
	});
});
