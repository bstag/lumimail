// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), snooze: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: h.push, refresh: h.refresh }) }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/message-actions/utils", () => ({ snoozeMessage: h.snooze }));

import { SnoozeMenu } from "@/components/message-actions/snooze-menu";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
	vi.clearAllMocks();
	h.snooze.mockResolvedValue(undefined);
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(() => {
	act(() => root.unmount());
	container.remove();
});

function render(props: Partial<Parameters<typeof SnoozeMenu>[0]> = {}) {
	const onError = vi.fn();
	act(() => root.render(
		<QueryClientProvider client={new QueryClient()}>
			<SnoozeMenu messageId="msg_1" disabled={false} onError={onError} {...props} />
		</QueryClientProvider>,
	));
	return { onError, select: container.querySelector("select") as HTMLSelectElement };
}

async function choose(select: HTMLSelectElement, value: string) {
	await act(async () => {
		select.value = value;
		select.dispatchEvent(new Event("change", { bubbles: true }));
	});
}

describe("SnoozeMenu (F100)", () => {
	it("snoozes with a preset and opens Snoozed", async () => {
		const { select } = render();
		expect([...select.options].map((option) => option.value)).toEqual(["", "later_today", "tomorrow", "next_week"]);

		await choose(select, "tomorrow");

		const [, messageId, until] = h.snooze.mock.calls[0] as [unknown, string, Date];
		expect(messageId).toBe("msg_1");
		expect(until.getHours()).toBe(8);
		expect(h.push).toHaveBeenCalledWith("/snoozed");
		expect(select.value).toBe("");
	});

	it("offers Unsnooze while sleeping and returns to the Inbox", async () => {
		const { select } = render({ snoozedUntil: new Date(Date.now() + 3_600_000).toISOString() });
		await choose(select, "wake");

		expect(h.snooze.mock.calls[0][2]).toBeNull();
		expect(h.push).toHaveBeenCalledWith("/inbox");
	});

	it("ignores the placeholder and reports a failure", async () => {
		const { select, onError } = render();
		await choose(select, "");
		expect(h.snooze).not.toHaveBeenCalled();

		h.snooze.mockRejectedValueOnce(new Error("down"));
		await choose(select, "later_today");
		expect(onError).toHaveBeenCalled();
		expect(h.push).not.toHaveBeenCalled();
	});
});
