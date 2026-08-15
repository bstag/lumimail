import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
	parseReceivedMailHeaders,
	publishMailFlowProof,
	runMailFlowEvidenceCommand,
} from "../../../scripts/mail-flow-evidence.mjs";

const temporary: string[] = [];
afterEach(() => temporary.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));

function eml(headers = "") {
	const root = mkdtempSync(join(tmpdir(), "lumimail-mail-flow-")); temporary.push(root);
	const path = join(root, "received.eml");
	writeFileSync(path, `From: private@example.com\r\nSubject: private\r\n${headers || [
		"Message-ID: <outbound@example.com>",
		"In-Reply-To: <inbound@example.com>",
		"References: <root@example.com>",
		" <inbound@example.com>",
	].join("\r\n")}\r\n\r\nPRIVATE BODY`);
	return path;
}

describe("received mail header parser", () => {
	it("extracts only normalized threading identifiers from a folded header block", () => {
		expect(parseReceivedMailHeaders(eml())).toEqual({
			deliveredMessageId: "<outbound@example.com>",
			deliveredInReplyTo: "<inbound@example.com>",
			deliveredReferences: "<root@example.com> <inbound@example.com>",
		});
	});

	it.each([
		"Message-ID: missing-brackets\r\nIn-Reply-To: <inbound@example.com>\r\nReferences: <inbound@example.com>",
		"Message-ID: <one@example.com>\r\nMessage-ID: <two@example.com>\r\nIn-Reply-To: <inbound@example.com>\r\nReferences: <inbound@example.com>",
		"Message-ID: <outbound@example.com>\r\nIn-Reply-To: <inbound@example.com>",
		"Bad Header\r\nMessage-ID: <outbound@example.com>\r\nIn-Reply-To: <inbound@example.com>\r\nReferences: <inbound@example.com>",
	])("rejects malformed, duplicate, or incomplete received headers", (headers) => {
		expect(() => parseReceivedMailHeaders(eml(headers))).toThrow("Received mail-flow proof is invalid.");
	});

	it("refuses oversized files before reading proof content", () => {
		const path = eml(); writeFileSync(path, Buffer.alloc(10 * 1024 * 1024 + 1));
		expect(() => parseReceivedMailHeaders(path)).toThrow("Received mail-flow proof is invalid.");
	});
});

describe("mail-flow evidence command", () => {
	it("posts only parsed identifiers with the runtime bearer", async () => {
		const publishProof = vi.fn(async () => ({ recorded: true, duplicate: false,
			outcome: "passed" as const, passedChecks: 8, totalChecks: 8 }));
		const stdout = vi.fn();
		await expect(runMailFlowEvidenceCommand([eml(), "https://mail.example.com"], {
			publishProof, environment: { ...process.env, LUMIMAIL_SESSION_TOKEN: "session-secret" },
			stdout, stderr: vi.fn(), now: () => new Date("2026-08-13T12:00:00.000Z"),
		})).resolves.toBe(0);
		expect(publishProof).toHaveBeenCalledWith({
			origin: "https://mail.example.com", sessionToken: "session-secret",
			proof: {
				format: "lumimail-mail-flow-proof-v1", deliveredMessageId: "<outbound@example.com>",
				deliveredInReplyTo: "<inbound@example.com>",
				deliveredReferences: "<root@example.com> <inbound@example.com>",
				observedAt: "2026-08-13T11:59:55.000Z",
			},
		});
		expect(stdout).toHaveBeenCalledWith("PASS  8/8 received mail-flow checks recorded");
		expect(JSON.stringify(stdout.mock.calls)).not.toMatch(/example\.com|session-secret|PRIVATE/);
	});

	it("returns non-zero for a derived failed proof and bounded publication failures", async () => {
		const stderr = vi.fn(); const stdout = vi.fn();
		await expect(runMailFlowEvidenceCommand([eml(), "https://mail.example.com"], {
			publishProof: vi.fn(async () => ({ recorded: true as const, duplicate: false,
				outcome: "failed" as const, passedChecks: 6, totalChecks: 8 })),
			environment: { ...process.env, LUMIMAIL_SESSION_TOKEN: "session-secret" }, stdout, stderr,
		})).resolves.toBe(1);
		expect(stdout).toHaveBeenCalledWith("FAIL  6/8 received mail-flow checks recorded");

		await expect(runMailFlowEvidenceCommand([eml(), "https://mail.example.com"], {
			publishProof: vi.fn(async () => { throw new Error("session-secret PRIVATE"); }),
			environment: { ...process.env, LUMIMAIL_SESSION_TOKEN: "session-secret" }, stdout, stderr,
		})).resolves.toBe(1);
		expect(stderr).toHaveBeenCalledWith("Mail-flow evidence could not be recorded.");
		expect(JSON.stringify(stderr.mock.calls)).not.toMatch(/session-secret|PRIVATE/);
	});

	it("prints the fixed local artifact class without exposing its path", async () => {
		const stderr = vi.fn();
		await expect(runMailFlowEvidenceCommand([
			"C:/private/missing-message.eml", "https://mail.example.com",
		], { environment: { ...process.env, LUMIMAIL_SESSION_TOKEN: "session-secret" },
			stdout: vi.fn(), stderr })).resolves.toBe(1);
		expect(stderr).toHaveBeenCalledWith("Received mail-flow proof is invalid.");
		expect(JSON.stringify(stderr.mock.calls)).not.toContain("missing-message.eml");
	});
});

describe("mail-flow proof publisher", () => {
	const proof = {
		format: "lumimail-mail-flow-proof-v1",
		deliveredMessageId: "<outbound@example.com>",
		deliveredInReplyTo: "<inbound@example.com>",
		deliveredReferences: "<inbound@example.com>",
		observedAt: "2026-08-13T12:00:00.000Z",
	};

	it("uses the exact endpoint, bearer, non-following redirect, and body", async () => {
		const fetchImpl = vi.fn(async () => Response.json({ success: true, data: {
			recorded: true, duplicate: false, outcome: "passed", passedChecks: 8, totalChecks: 8,
		} }, { status: 201 }));
		await expect(publishMailFlowProof({
			origin: "https://mail.example.com", sessionToken: "session-secret", proof, fetchImpl,
		})).resolves.toMatchObject({ outcome: "passed", passedChecks: 8 });
		expect(fetchImpl).toHaveBeenCalledWith(
			"https://mail.example.com/api/admin/operations/evidence/mail-flow",
			expect.objectContaining({ method: "POST", redirect: "error", body: JSON.stringify(proof),
				headers: expect.objectContaining({ authorization: "Bearer session-secret" }) }),
		);
	});

	it.each([
		["http://mail.example.com", "session-secret"],
		["https://mail.example.com/path", "session-secret"],
		["https://mail.example.com", ""],
		["https://mail.example.com", "token with space"],
	])("rejects an unsafe origin or bearer before fetch", async (origin, sessionToken) => {
		const fetchImpl = vi.fn();
		await expect(publishMailFlowProof({ origin, sessionToken, proof, fetchImpl }))
			.rejects.toThrow("Mail-flow evidence could not be recorded.");
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it.each([
		() => Promise.reject(new Error("session-secret PRIVATE")),
		() => Promise.resolve(new Response("session-secret PRIVATE", { status: 403 })),
		() => Promise.resolve(Response.json({ success: true, data: {
			recorded: true, duplicate: false, outcome: "passed", passedChecks: 7, totalChecks: 8,
		} }, { status: 201 })),
	])("collapses transport and malformed response details", async (fetchImpl) => {
		let caught: unknown;
		try {
			await publishMailFlowProof({ origin: "https://mail.example.com", sessionToken: "session-secret",
				proof, fetchImpl });
		} catch (error) { caught = error; }
		expect(String(caught)).toContain("Mail-flow evidence could not be recorded.");
		expect(String(caught)).not.toMatch(/session-secret|PRIVATE/);
	});

	it.each([
		[401, "Unauthorized", "Mail-flow evidence requires a valid owner session."],
		[403, "Forbidden", "Organization owner access is required."],
		[403, "Recent authentication required", "Recent owner authentication is required."],
		[400, "Invalid mail-flow proof", "Received mail-flow proof did not match accepted evidence."],
		[409, "Evidence already exists with a different result", "Mail-flow evidence conflicts with existing history."],
	])("maps only an exact known status and error envelope", async (status, message, expected) => {
		const fetchImpl = vi.fn(async () => Response.json({ success: false, error: { message } }, { status }));
		await expect(publishMailFlowProof({
			origin: "https://mail.example.com", sessionToken: "session-secret", proof, fetchImpl,
		})).rejects.toThrow(expected);
	});

	it("keeps a known status generic when the envelope has extra or changed content", async () => {
		for (const body of [
			{ success: false, error: { message: "Recent authentication required", detail: "PRIVATE" } },
			{ success: false, error: { message: "Changed server text" } },
		]) {
			await expect(publishMailFlowProof({
				origin: "https://mail.example.com", sessionToken: "session-secret", proof,
				fetchImpl: vi.fn(async () => Response.json(body, { status: 403 })),
			})).rejects.toThrow("Mail-flow evidence could not be recorded.");
		}
	});
});
