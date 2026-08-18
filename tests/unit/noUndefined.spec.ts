import { expect, test } from "@playwright/test";
import { stripUndefined } from "../../src/state/commitState";
import { __test } from "../../src/webhooks/gitlab";

const { applyPipelineEvent, applyJobEvent } = __test;

/**
 * Firestore rejects any document containing `undefined`. The in-memory test
 * backend round-trips through JSON, which drops undefined silently, so a
 * backend-agnostic assertion is the only thing that catches this class.
 */
const undefinedPaths = (value: unknown, path = "$"): string[] => {
	if (value === undefined) return [path];
	if (Array.isArray(value)) return value.flatMap((v, i) => undefinedPaths(v, `${path}[${i}]`));
	if (value !== null && typeof value === "object") {
		return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
			undefinedPaths(v, `${path}.${k}`),
		);
	}
	return [];
};

const pushPipeline = {
	object_kind: "pipeline",
	project: { id: 7, name: "demo-app" },
	object_attributes: {
		id: 1,
		sha: "abc",
		ref: "master",
		source: "push",
		status: "running",
		stages: ["build"],
		url: "https://gitlab.example.com/p/1",
		duration: 10,
	},
	commit: { title: "t", url: "https://gitlab.example.com/c/abc", author: { name: "Ada" } },
	builds: [{ id: 1, name: "compile", stage: "build", status: "success", allow_failure: false }],
};

const runningJob = {
	object_kind: "build",
	sha: "abc",
	ref: "master",
	project_id: 7,
	project_name: "demo-app",
	pipeline_id: 1,
	build_id: 2,
	build_name: "unit",
	build_stage: "test",
	build_status: "running",
	build_allow_failure: false,
	commit: { message: "t", author_name: "Ada" },
};

test.describe("state never contains undefined (Firestore rejects it)", () => {
	test("push pipeline without a merge request", () => {
		expect(undefinedPaths(applyPipelineEvent(undefined, pushPipeline))).toEqual([]);
	});

	test("job event for a job that has not finished", () => {
		expect(undefinedPaths(applyJobEvent(undefined, runningJob))).toEqual([]);
	});

	test("job event applied on top of an existing pipeline", () => {
		const withPipeline = applyPipelineEvent(undefined, pushPipeline);
		expect(undefinedPaths(applyJobEvent(withPipeline, runningJob))).toEqual([]);
	});

	test("pipeline event with no url and no duration", () => {
		const bare = {
			...pushPipeline,
			object_attributes: { ...pushPipeline.object_attributes, url: undefined, duration: undefined },
		};
		expect(undefinedPaths(stripUndefined(applyPipelineEvent(undefined, bare)))).toEqual([]);
	});

	test("a merge-request pipeline still records its merge request", () => {
		const mr = {
			...pushPipeline,
			merge_request: {
				iid: 42,
				title: "chore: bump the build cache",
				url: "https://gitlab.example.com/mr/42",
				target_branch: "master",
			},
		};
		const state = applyPipelineEvent(undefined, mr);
		expect(undefinedPaths(state)).toEqual([]);
		expect(state.mergeRequest?.iid).toBe(42);
	});

	test("an earlier merge request survives a later push event", () => {
		const mr = {
			...pushPipeline,
			merge_request: {
				iid: 42,
				title: "chore: bump the build cache",
				url: "https://gitlab.example.com/mr/42",
				target_branch: "master",
			},
		};
		const afterMr = applyPipelineEvent(undefined, mr);
		const afterPush = applyPipelineEvent(afterMr, pushPipeline);
		expect(afterPush.mergeRequest?.iid).toBe(42);
		expect(undefinedPaths(afterPush)).toEqual([]);
	});
});

test.describe("stripUndefined", () => {
	test("removes undefined keys at any depth and leaves everything else", () => {
		const out = stripUndefined({
			a: 1,
			b: undefined,
			c: { d: undefined, e: [1, undefined, { f: undefined, g: 2 }] },
			h: null,
		});
		expect(undefinedPaths(out)).toEqual([]);
		expect(out).toEqual({ a: 1, c: { e: [1, { g: 2 }] }, h: null });
	});
});
