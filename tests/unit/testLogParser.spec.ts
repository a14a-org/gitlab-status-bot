import { expect, test } from "@playwright/test";
import { isTestJob, parseJestOutput } from "../../src/services/testLogParser";

const JEST_OUTPUT = `
PASS src/foo.test.ts (1.234 s)
PASS src/bar.test.ts
FAIL src/baz.test.ts (0.5 s)
  ✕ does the thing (12 ms)

Test Suites: 1 failed, 2 passed, 3 total
Tests:       1 failed, 9 passed, 10 total
Time:        2.5 s
`;

test.describe("parseJestOutput", () => {
	test("parses suite and test summary counts", () => {
		const result = parseJestOutput(JEST_OUTPUT);
		expect(result).not.toBeNull();
		expect(result?.suites).toEqual({ total: 3, passed: 2, failed: 1 });
		expect(result?.tests).toEqual({ total: 10, passed: 9, failed: 1 });
		expect(result?.duration).toBe("2.5s");
	});

	test("collects PASS/FAIL test files with durations", () => {
		const result = parseJestOutput(JEST_OUTPUT);
		const files = result?.testFiles ?? [];
		const baz = files.find((f) => f.name === "src/baz.test.ts");
		expect(baz?.status).toBe("FAIL");
		expect(baz?.duration).toBe("0.5s");
		const bar = files.find((f) => f.name === "src/bar.test.ts");
		expect(bar?.status).toBe("PASS");
		expect(bar?.duration).toBeUndefined();
	});

	test("extracts failed test details when tests fail", () => {
		const result = parseJestOutput(JEST_OUTPUT);
		expect(result?.failedTests?.length).toBeGreaterThan(0);
		expect(result?.failedTests?.[0].testName).toBe("does the thing");
		expect(result?.failedTests?.[0].file).toContain("src/baz.test.ts");
	});

	test("parses coverage summary when present", () => {
		const withCoverage = `${JEST_OUTPUT}\nAll files            |   85.71 |    50.0 |   90.0 |   88.2 |\n`;
		const result = parseJestOutput(withCoverage);
		expect(result?.coverage?.statements.percentage).toBe(85.71);
		expect(result?.coverage?.branches.percentage).toBe(50);
		expect(result?.coverage?.functions.percentage).toBe(90);
		expect(result?.coverage?.lines.percentage).toBe(88.2);
	});

	test("returns null for non-jest output", () => {
		expect(parseJestOutput("just some random build logs with no markers")).toBeNull();
	});

	test("returns empty results for a succeeded job with no test output", () => {
		const result = parseJestOutput("Job succeeded");
		expect(result).not.toBeNull();
		expect(result?.tests.total).toBe(0);
		expect(result?.duration).toBe("N/A");
	});

	test("derives summary from files when no summary line exists", () => {
		const result = parseJestOutput("PASS a.test.ts\nFAIL b.test.ts");
		expect(result?.suites.total).toBe(2);
		expect(result?.suites.passed).toBe(1);
		expect(result?.suites.failed).toBe(1);
	});
});

test.describe("isTestJob", () => {
	test("matches common test job names case-insensitively", () => {
		for (const name of ["unit-tests", "Jest", "run-e2e", "integration", "coverage", "SPEC"]) {
			expect(isTestJob(name)).toBe(true);
		}
	});

	test("rejects non-test job names", () => {
		for (const name of ["build", "deploy", "lint", "publish-image"]) {
			expect(isTestJob(name)).toBe(false);
		}
	});
});
