import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
	await Promise.all(servers.splice(0).map((server) => new Promise<void>((done) => server.close(() => done()))));
});

async function startSmokeTarget(overrides: Record<string, number> = {}) {
	const anonymous = new Set(["/api/auth/me", "/api/mailboxes", "/api/admin/mailboxes"]);
	const server = createServer((request, response) => {
		const path = request.url ?? "/";
		response.statusCode = overrides[path] ?? (anonymous.has(path) ? 401 : 200);
		response.end();
	});
	servers.push(server);
	await new Promise<void>((done) => server.listen(0, "127.0.0.1", () => done()));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Smoke target did not bind a TCP port");
	return `http://127.0.0.1:${address.port}`;
}

async function runSmoke(baseUrl: string) {
	return execFileAsync(process.execPath, [resolve(process.cwd(), "scripts/smoke.mjs"), baseUrl]);
}

describe("deployment smoke command", () => {
	it("exits successfully when every public and anonymous boundary matches", async () => {
		const result = await runSmoke(await startSmokeTarget());

		expect(result.stdout).toContain("6/6 passed");
	});

	it("exits non-zero and names a failed boundary", async () => {
		await expect(runSmoke(await startSmokeTarget({ "/api/mailboxes": 200 }))).rejects.toMatchObject({
			code: 1,
			stdout: expect.stringContaining("FAIL  200    /api/mailboxes"),
		});
	});
});
