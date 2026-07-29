import { execFile, spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const startupTimeoutMs = 120_000;

async function isReady(url: string): Promise<boolean> {
	try {
		const response = await fetch(url);
		return response.status >= 200 && response.status < 500;
	} catch {
		return false;
	}
}

async function waitForReady(child: ChildProcess, url: string): Promise<void> {
	const deadline = Date.now() + startupTimeoutMs;
	while (Date.now() < deadline) {
		if (child.exitCode !== null) {
			throw new Error(`Next.js test server exited with code ${child.exitCode} before becoming ready`);
		}
		if (await isReady(url)) return;
		await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
	}
	throw new Error(`Next.js test server did not become ready within ${startupTimeoutMs}ms`);
}

async function stopProcessTree(child: ChildProcess): Promise<void> {
	if (!child.pid || child.exitCode !== null) return;

	if (process.platform === "win32") {
		await execFileAsync("taskkill", ["/pid", String(child.pid), "/T", "/F"]).catch(() => {
			child.kill();
		});
	} else {
		try {
			process.kill(-child.pid, "SIGTERM");
		} catch {
			child.kill("SIGTERM");
		}
	}

	await Promise.race([
		new Promise<void>((resolveExit) => child.once("exit", () => resolveExit())),
		new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 5_000)),
	]);

	if (child.exitCode === null) {
		if (process.platform === "win32") child.kill();
		else {
			try {
				process.kill(-child.pid, "SIGKILL");
			} catch {
				child.kill("SIGKILL");
			}
		}
	}
}

export default async function startE2EServer(): Promise<() => Promise<void>> {
	const port = process.env.PLAYWRIGHT_PORT ?? process.env.PORT ?? "3000";
	const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${port}`;
	const readinessURL = new URL("/manifest.webmanifest", baseURL).toString();

	if (await isReady(readinessURL)) return async () => {};

	const child = spawn(
		process.execPath,
		[resolve("node_modules", "next", "dist", "bin", "next"), "dev", "--port", port],
		{
			cwd: process.cwd(),
			detached: process.platform !== "win32",
			env: {
				...process.env,
				XDG_CONFIG_HOME: resolve(".wrangler", "playwright-config"),
				LUMIMAIL_CLOUDFLARE_DEV:
					process.env.npm_lifecycle_event === "e2e:local" ? "true" : "false",
			},
			stdio: "ignore",
		},
	);

	try {
		await waitForReady(child, readinessURL);
	} catch (error) {
		await stopProcessTree(child);
		throw error;
	}

	return () => stopProcessTree(child);
}
