import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fill } from "../../src/browser/client.ts";

const originalPath = process.env.PATH;
const fixtureBin = join(import.meta.dir, "..", "fixtures", "fake-bin");
const temporaryDirs: string[] = [];

afterEach(() => {
	process.env.PATH = originalPath;
	delete process.env.SUNAT_TEST_BROWSER_ARGS;
	delete process.env.SUNAT_TEST_BROWSER_STDIN;
	delete process.env.SUNAT_TEST_BROWSER_ENV;
	delete process.env.SUNAT_TEST_BROWSER_FAIL;
	delete process.env.SUNAT_TEST_BROWSER_ERROR;
	delete process.env.SUNAT_PASSWORD;
	for (const dir of temporaryDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function capturePaths(): { args: string; stdin: string; env: string } {
	const dir = mkdtempSync(join(tmpdir(), "sunat-browser-privacy-"));
	temporaryDirs.push(dir);
	return { args: join(dir, "args"), stdin: join(dir, "stdin"), env: join(dir, "env") };
}

describe("browser input privacy", () => {
	test("passes filled values through stdin instead of process arguments", async () => {
		const capture = capturePaths();
		chmodSync(join(fixtureBin, "agent-browser"), 0o755);
		process.env.PATH = `${fixtureBin}:${originalPath || ""}`;
		process.env.SUNAT_TEST_BROWSER_ARGS = capture.args;
		process.env.SUNAT_TEST_BROWSER_STDIN = capture.stdin;
		process.env.SUNAT_TEST_BROWSER_ENV = capture.env;
		process.env.SUNAT_PASSWORD = "ambient-private-clave-sol";
		const secret = "private-clave-sol";

		await fill("@e3", secret);

		expect(readFileSync(capture.args, "utf8")).not.toContain(secret);
		expect(readFileSync(capture.stdin, "utf8")).toContain(secret);
		expect(readFileSync(capture.env, "utf8")).toBe("");
	});

	test("does not echo browser stderr when filling fails", async () => {
		const capture = capturePaths();
		chmodSync(join(fixtureBin, "agent-browser"), 0o755);
		process.env.PATH = `${fixtureBin}:${originalPath || ""}`;
		process.env.SUNAT_TEST_BROWSER_ARGS = capture.args;
		process.env.SUNAT_TEST_BROWSER_STDIN = capture.stdin;
		process.env.SUNAT_TEST_BROWSER_FAIL = "1";
		process.env.SUNAT_TEST_BROWSER_ERROR = "private-clave-sol";

		const error = await fill("@e3", "private-clave-sol").catch((value) => value);

		expect(error.message).toBe("fill @e3 failed");
		expect(error.message).not.toContain("private-clave-sol");
	});
});
