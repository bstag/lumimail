import { describe, expect, it, vi } from "vitest";

import { runMcpEvidenceCommand } from "../../../scripts/mcp-evidence.mjs";

describe("runMcpEvidenceCommand", () => {
	it("passes only bounded inputs to the verifier and prints content-free checks", async () => {
		const prove = vi.fn().mockResolvedValue({
			outcome: "passed",
			checks: ["discovery", "pkce", "tools", "refresh", "revocation"],
		});
		const stdout = vi.fn();
		const environment = {
			...process.env,
			LUMIMAIL_SESSION_TOKEN: "session-secret",
			LUMIMAIL_MCP_FROM: "sender@example.com",
			LUMIMAIL_MCP_TO: "recipient@example.net",
		};

		expect(await runMcpEvidenceCommand(
			["https://mail.example.com", "actions"],
			{ prove, stdout, stderr: vi.fn(), environment },
		)).toBe(0);
		expect(prove).toHaveBeenCalledWith({
			origin: "https://mail.example.com",
			profile: "actions",
			sessionToken: "session-secret",
			from: "sender@example.com",
			to: "recipient@example.net",
		});
		expect(stdout.mock.calls.flat().join(" ")).toBe(
			"PASS  discovery PASS  pkce PASS  tools PASS  refresh PASS  revocation PASS  5/5 MCP OAuth evidence checks",
		);
		expect(stdout.mock.calls.flat().join(" ")).not.toMatch(/session-secret|sender@|recipient@/);
	});

	it("accepts read mode without mail-action addresses", async () => {
		const prove = vi.fn().mockResolvedValue({ outcome: "passed", checks: ["tools"] });
		expect(await runMcpEvidenceCommand(
			["https://mail.example.com", "read"],
			{ prove, stdout: vi.fn(), stderr: vi.fn(), environment: { ...process.env, LUMIMAIL_SESSION_TOKEN: "token" } },
		)).toBe(0);
		expect(prove).toHaveBeenCalledWith(expect.objectContaining({ profile: "read", from: undefined, to: undefined }));
	});

	it.each([
		[[], {}],
		[["https://mail.example.com", "invalid"], { LUMIMAIL_SESSION_TOKEN: "token" }],
		[["https://mail.example.com", "read"], {}],
		[["https://mail.example.com", "actions"], { LUMIMAIL_SESSION_TOKEN: "token" }],
	])("rejects incomplete invocations", async (args, environment) => {
		const stderr = vi.fn();
		expect(await runMcpEvidenceCommand(args as string[], {
			prove: vi.fn(), stdout: vi.fn(), stderr, environment: { ...process.env, ...environment },
		})).toBe(1);
		expect(stderr).toHaveBeenCalledWith(expect.stringContaining("Usage:"));
	});

	it("fails with one bounded message and never leaks verifier errors", async () => {
		const stderr = vi.fn();
		expect(await runMcpEvidenceCommand(["https://mail.example.com", "read"], {
			prove: vi.fn().mockRejectedValue(new Error("PRIVATE token detail")),
			stdout: vi.fn(), stderr,
			environment: { ...process.env, LUMIMAIL_SESSION_TOKEN: "token" },
		})).toBe(1);
		expect(stderr).toHaveBeenCalledWith("MCP OAuth evidence could not be recorded.");
	});
});
