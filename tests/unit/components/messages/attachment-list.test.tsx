// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const authFetch = vi.fn();
vi.mock("@/lib/auth/client", () => ({ authFetch: (...args: unknown[]) => authFetch(...args) }));

import { AttachmentList } from "@/components/messages/attachment-list";

let root: Root | undefined;
let container: HTMLDivElement;

async function renderList(payload: unknown, ok = true) {
	authFetch.mockResolvedValue({ ok, json: async () => payload });
	container = document.createElement("div") as HTMLDivElement;
	document.body.appendChild(container);
	root = createRoot(container);
	await act(async () => {
		root?.render(<AttachmentList messageId="msg_1" />);
		await Promise.resolve();
		await Promise.resolve();
	});
}

beforeEach(() => authFetch.mockReset());
afterEach(async () => {
	await act(async () => root?.unmount());
	container?.remove();
	root = undefined;
});

describe("AttachmentList", () => {
	it("renders regular image, PDF, and download-only attachments", async () => {
		await renderList({ data: { attachmentStatus: "stored", attachments: [
			{ id: "a1", filename: "small.png", contentType: " IMAGE/PNG ", size: 12, disposition: "attachment", contentId: null },
			{ id: "a2", filename: "paper.pdf", contentType: "application/pdf", size: 2048, disposition: "attachment", contentId: null },
			{ id: "a3", filename: "large.bin", contentType: "application/octet-stream", size: 2 * 1024 * 1024, disposition: "attachment", contentId: null },
			{ id: "inline", filename: "inline.png", contentType: "image/png", size: 10, disposition: "inline", contentId: "cid_1" },
		] } });

		expect(authFetch).toHaveBeenCalledWith("/api/messages/msg_1/attachments");
		expect(container.textContent).toContain("3 attachments");
		expect(container.textContent).toContain("12 B");
		expect(container.textContent).toContain("2.0 KB");
		expect(container.textContent).toContain("2.0 MB");
		expect(container.querySelector('img[alt="small.png"]')).not.toBeNull();
		expect(container.querySelector('iframe[title="paper.pdf"]')).not.toBeNull();
		expect(container.textContent).not.toContain("inline.png");
	});

	it("renders omission errors and otherwise stays empty", async () => {
		await renderList({ data: { attachmentStatus: "omitted", attachmentError: null } });
		expect(container.textContent).toContain("Attachments were omitted for safety.");
		await act(async () => root?.unmount());
		container.remove();
		root = undefined;

		await renderList({ data: { attachmentStatus: "none", attachments: [] } });
		expect(container.innerHTML).toBe("");
	});

	it("treats failed and malformed responses as best-effort empty state", async () => {
		await renderList(null, false);
		expect(container.innerHTML).toBe("");
	});
});
