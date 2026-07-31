import { afterEach, describe, expect, it, vi } from "vitest";
import {
	attachmentKey,
	cleanupAttachmentObjects,
	sanitizeAttachmentFilename,
} from "@/lib/email/attachment-storage";

const NUL = String.fromCharCode(0);
const DEL = String.fromCharCode(0x7f);

function envWithDelete() {
	const del = vi.fn(async () => undefined);
	return { env: { BUCKET: { delete: del } } as unknown as CloudflareEnv, del };
}

afterEach(() => vi.restoreAllMocks());

describe("attachmentKey", () => {
	it("produces the canonical user/message-scoped key", () => {
		expect(attachmentKey("u1", "msg_1", "att_1")).toBe("attachments/u1/msg_1/att_1");
	});
});

describe("cleanupAttachmentObjects", () => {
	it("does nothing for an empty key list", async () => {
		const { env, del } = envWithDelete();
		await cleanupAttachmentObjects(env, []);
		expect(del).not.toHaveBeenCalled();
	});

	it("deletes a single key as a scalar", async () => {
		const { env, del } = envWithDelete();
		await cleanupAttachmentObjects(env, ["attachments/u1/m/a"]);
		expect(del).toHaveBeenCalledWith("attachments/u1/m/a");
	});

	it("deletes multiple keys in one bulk call", async () => {
		const { env, del } = envWithDelete();
		await cleanupAttachmentObjects(env, ["attachments/u1/m/a", "attachments/u1/m/b"]);
		expect(del).toHaveBeenCalledTimes(1);
		expect(del).toHaveBeenCalledWith(["attachments/u1/m/a", "attachments/u1/m/b"]);
	});

	it("logs and resolves when the delete fails", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const { env, del } = envWithDelete();
		del.mockRejectedValueOnce(new Error("r2 down"));

		await expect(cleanupAttachmentObjects(env, ["k"])).resolves.toBeUndefined();
		expect(errorSpy).toHaveBeenCalledWith("Failed to clean up attachment objects");
	});
});

describe("sanitizeAttachmentFilename", () => {
	it("strips path components for both separators", () => {
		expect(sanitizeAttachmentFilename("../folder/report.pdf")).toBe("report.pdf");
		expect(sanitizeAttachmentFilename("..\\folder\\report.pdf")).toBe("report.pdf");
	});

	it("removes control characters and trims", () => {
		expect(sanitizeAttachmentFilename(`../quarter${NUL}.pdf`)).toBe("quarter.pdf");
		expect(sanitizeAttachmentFilename(`  spaced${DEL}.txt  `)).toBe("spaced.txt");
	});

	it("caps the result at 255 characters", () => {
		expect(sanitizeAttachmentFilename(`${"a".repeat(300)}.txt`)).toHaveLength(255);
	});

	it("falls back to 'attachment' for null or names that sanitize to nothing", () => {
		expect(sanitizeAttachmentFilename(null)).toBe("attachment");
		expect(sanitizeAttachmentFilename(`../${NUL}`)).toBe("attachment");
		expect(sanitizeAttachmentFilename("")).toBe("attachment");
	});
});
