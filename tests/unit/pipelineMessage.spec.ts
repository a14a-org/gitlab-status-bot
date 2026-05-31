import { expect, test } from "@playwright/test";
import { buildPipelineMessageBlocks } from "../../src/views/pipelineMessage";

type Block = {
	type: string;
	text?: { text?: string };
	accessory?: { action_id?: string };
	elements?: Array<{ action_id?: string; value?: string }>;
};

type Build = { id: number; name: string; stage: string; status: string };
interface Overrides {
	object_attributes?: { id?: number; ref?: string; stages?: string[] };
	builds?: Build[];
}

const pipeline = (overrides: Overrides = {}) => ({
	object_attributes: {
		id: 4242,
		ref: "main",
		stages: ["build", "test", "deploy"],
		...(overrides.object_attributes ?? {}),
	},
	project: { name: "demo-app" },
	commit: {
		id: "abcdef123456",
		url: "https://gitlab.example.com/commit/abcdef123456",
		author: { name: "Ada Lovelace" },
	},
	builds: overrides.builds ?? [
		{ id: 1, name: "compile", stage: "build", status: "success" },
		{ id: 2, name: "unit-tests", stage: "test", status: "failed" },
		{ id: 3, name: "deploy-prod", stage: "deploy", status: "created" },
	],
});

const dump = (blocks: Block[]) => JSON.stringify(blocks);

test.describe("buildPipelineMessageBlocks", () => {
	test("renders a header with the project name and a commit context line", () => {
		const blocks = buildPipelineMessageBlocks(pipeline(), new Set()) as Block[];
		expect(blocks[0].type).toBe("header");
		expect(blocks[0].text?.text).toBe("Deployment for demo-app");
		const ctx = blocks[1];
		expect(ctx.type).toBe("context");
		expect(dump([ctx])).toContain("abcdef12");
		expect(dump([ctx])).toContain("Ada Lovelace");
	});

	test("emits one section per declared stage with correct status emoji", () => {
		const blocks = buildPipelineMessageBlocks(pipeline(), new Set()) as Block[];
		const stageSections = blocks.filter(
			(b) => b.type === "section" && /\*(build|test|deploy)\*/.test(b.text?.text ?? ""),
		);
		expect(stageSections).toHaveLength(3);
		const buildStage = stageSections.find((b) => b.text?.text?.includes("*build*"));
		expect(buildStage?.text?.text).toContain("✅");
		const testStage = stageSections.find((b) => b.text?.text?.includes("*test*"));
		expect(testStage?.text?.text).toContain("❌");
	});

	test("expanding a stage reveals job-level fields", () => {
		const collapsed = buildPipelineMessageBlocks(pipeline(), new Set()) as Block[];
		const expanded = buildPipelineMessageBlocks(pipeline(), new Set(["test"])) as Block[];
		expect(expanded.length).toBeGreaterThan(collapsed.length);
		expect(dump(expanded)).toContain("unit-tests");
		const testSection = collapsed.find((b) => b.text?.text?.includes("*test*"));
		expect(testSection?.accessory?.action_id).toBe("show_stage");
	});

	test("adds danger error-log + test-summary buttons for a failed test job", () => {
		const blocks = buildPipelineMessageBlocks(pipeline(), new Set()) as Block[];
		const ids = blocks
			.filter((b) => b.type === "actions")
			.flatMap((r) => (r.elements ?? []).map((e) => e.action_id ?? ""));
		expect(ids).toContain("show_error_log_2");
		expect(ids).toContain("show_test_summary_2");
	});

	test("adds a primary test-summary button for a passing test job", () => {
		const data = pipeline({
			builds: [{ id: 9, name: "jest-suite", stage: "test", status: "success" }],
			object_attributes: { id: 1, ref: "main", stages: ["test"] },
		});
		const blocks = buildPipelineMessageBlocks(data, new Set()) as Block[];
		const ids = blocks
			.filter((b) => b.type === "actions")
			.flatMap((r) => (r.elements ?? []).map((e) => e.action_id ?? ""));
		expect(ids).toContain("show_test_summary_9");
		expect(ids).not.toContain("show_error_log_9");
	});

	test("shows a not-started placeholder for stages without builds", () => {
		const data = pipeline({
			builds: [{ id: 1, name: "compile", stage: "build", status: "success" }],
		});
		const blocks = buildPipelineMessageBlocks(data, new Set()) as Block[];
		const deploy = blocks.find((b) => b.text?.text === "⏳ *deploy*");
		expect(deploy).toBeTruthy();
	});
});
