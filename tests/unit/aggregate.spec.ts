import { expect, test } from "@playwright/test";
import { rollUp, shouldPostCard } from "../../src/domain/aggregate";
import type { CommitState, Job, PipelineSnapshot } from "../../src/domain/types";

const job = (id: number, name: string, stage: string, status: string, allowFailure = false): Job =>
	({ id, name, stage, status, allowFailure }) as Job;

const pipeline = (
	id: number,
	source: string,
	status: string,
	stages: string[],
	jobs: Job[],
): PipelineSnapshot =>
	({
		id,
		source,
		status,
		stages,
		jobs: Object.fromEntries(jobs.map((j) => [String(j.id), j])),
		updatedAt: 0,
	}) as PipelineSnapshot;

const state = (pipelines: PipelineSnapshot[], ref = "master"): CommitState => ({
	projectId: 7,
	sha: "9f8c0d2a1b3e4f5a6b7c8d9e0f1a2b3c4d5e6f70",
	ref,
	projectName: "demo-app",
	commitTitle: "fix: something",
	commitUrl: "https://gitlab.example.com/c/9f8c0d2a",
	authorName: "Ada Lovelace",
	pipelines: Object.fromEntries(pipelines.map((p) => [String(p.id), p])),
	postedLogJobIds: [],
	detailsPosted: false,
	createdAt: 0,
	updatedAt: 0,
});

test.describe("rollUp", () => {
	test("merges the push and merge-request pipelines of one commit", () => {
		const rollup = rollUp(
			state([
				pipeline(1, "push", "running", ["build"], [job(10, "compile", "build", "success")]),
				pipeline(
					2,
					"merge_request_event",
					"running",
					["test"],
					[job(20, "unit", "test", "running")],
				),
			]),
		);

		expect(rollup.pipelines).toHaveLength(2);
		expect(rollup.jobs).toHaveLength(2);
		expect(rollup.stages.map((s) => s.name)).toEqual(["build", "test"]);
		expect(rollup.status).toBe("running");
	});

	test("deduplicates a job reported by both the pipeline and the job hook", () => {
		const rollup = rollUp(
			state([
				pipeline(
					1,
					"push",
					"running",
					["build"],
					[job(10, "compile", "build", "success"), job(10, "compile", "build", "success")],
				),
			]),
		);
		expect(rollup.jobs).toHaveLength(1);
	});

	test("a stage is only successful once every job has finished", () => {
		const rollup = rollUp(
			state([
				pipeline(
					1,
					"push",
					"running",
					["build"],
					[job(1, "a", "build", "success"), job(2, "b", "build", "running")],
				),
			]),
		);
		const build = rollup.stages.find((s) => s.name === "build");
		expect(build?.status).toBe("running");
		expect(build?.done).toBe(1);
		expect(build?.total).toBe(2);
	});

	test("a job allowed to fail does not fail the commit", () => {
		const rollup = rollUp(
			state([
				pipeline(
					1,
					"push",
					"success",
					["test"],
					[job(1, "flaky", "test", "failed", true), job(2, "solid", "test", "success")],
				),
			]),
		);
		expect(rollup.failedJobs).toHaveLength(0);
		expect(rollup.status).not.toBe("failed");
	});

	test("skipped jobs are excluded from stage totals", () => {
		const rollup = rollUp(
			state([
				pipeline(
					1,
					"push",
					"success",
					["build"],
					[job(1, "a", "build", "success"), job(2, "b", "build", "skipped")],
				),
			]),
		);
		const build = rollup.stages.find((s) => s.name === "build");
		expect(build?.total).toBe(1);
		expect(build?.status).toBe("success");
	});

	test("reports complete only when every pipeline is terminal", () => {
		const mixed = rollUp(
			state([
				pipeline(1, "push", "success", ["build"], [job(1, "a", "build", "success")]),
				pipeline(2, "merge_request_event", "running", ["test"], [job(2, "b", "test", "running")]),
			]),
		);
		expect(mixed.complete).toBe(false);
	});
});

test.describe("shouldPostCard", () => {
	const withRef = (ref: string, stages: string[]) => {
		const s = state(
			[pipeline(1, "push", "running", stages, [job(1, "a", stages[0], "running")])],
			ref,
		);
		return { s, rollup: rollUp(s) };
	};

	test("posts for a configured deploy branch", () => {
		const { s, rollup } = withRef("master", ["build"]);
		expect(shouldPostCard(s, rollup)).toBe(true);
	});

	test("posts for any branch whose pipeline carries a deploy stage", () => {
		const { s, rollup } = withRef("feature/whatever", ["build", "deploy_acc"]);
		expect(shouldPostCard(s, rollup)).toBe(true);
	});

	test("stays silent for an ordinary feature branch", () => {
		const { s, rollup } = withRef("feature/whatever", ["build", "test"]);
		expect(shouldPostCard(s, rollup)).toBe(false);
	});
});
