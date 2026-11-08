// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/lib/auth/client", () => ({ authFetch: vi.fn() }));
vi.mock("next-intl", () => ({
	useTranslations: () => (key: string, values?: { count?: number }) => (values ? `${key}:${values.count}` : key),
}));

import { MessageBody } from "@/components/messages/message-body";

let root: Root | undefined;
let container: HTMLDivElement;

afterEach(() => {
	act(() => root?.unmount());
	container?.remove();
	root = undefined;
});

function render(body: Parameters<typeof MessageBody>[0]["body"]) {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	act(() => root?.render(<MessageBody messageId="msg_1" body={body} />));
}

describe("MessageBody", () => {
	it("renders plain text as wrapped prose, not a monospace <pre> panel", () => {
		render({
			latestContent: "Hello\nhttps://track.example.com/?xtl=averyveryverylongtoken",
			quotedContent: [{ dateLine: "On Mon, Bob wrote:", content: "Earlier" }],
			htmlBody: null,
		});

		expect(container.querySelector("pre")).toBeNull();
		expect(container.textContent).toContain("Hello");
		expect(container.querySelector("blockquote")?.textContent).toContain("Earlier");
	});

	it("renders sanitized HTML when present", () => {
		render({ latestContent: "ignored", quotedContent: [], htmlBody: "<p><b>Bold</b></p>" });

		expect(container.querySelector("b")?.textContent).toBe("Bold");
		expect(container.textContent).not.toContain("ignored");
	});

	it("withholds remote images behind a notice until the reader chooses to show them", () => {
		render({
			latestContent: "",
			quotedContent: [],
			htmlBody: '<p>Hi</p><img data-remote-src="https://cdn.example.com/a.png" alt="A">',
		});

		expect(container.textContent).toContain("remoteImagesHidden:1");
		expect(container.querySelector("img")?.getAttribute("src")).toBeNull();
		act(() => (container.querySelector("button") as HTMLButtonElement).click());
		expect(container.textContent).not.toContain("remoteImagesHidden");
		expect(container.querySelector("img")?.getAttribute("src"))
			.toBe("/api/messages/msg_1/remote-image?u=https%3A%2F%2Fcdn.example.com%2Fa.png");
	});
});
