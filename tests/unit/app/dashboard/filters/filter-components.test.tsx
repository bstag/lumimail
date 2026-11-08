// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
	search: new URLSearchParams(), post: vi.fn(), preview: vi.fn(), apply: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useSearchParams: () => h.search }));
vi.mock("next-intl", () => ({
	useTranslations: () => (key: string, values?: Record<string, unknown>) => values ? `${key}:${JSON.stringify(values)}` : key,
}));
vi.mock("@/lib/api/client-response", () => ({ apiJson: { post: h.post } }));
vi.mock("@/app/(dashboard)/filters/utils", async (importOriginal) => ({
	...(await importOriginal<object>()), previewFilter: h.preview, applyFilter: h.apply,
}));

import { FilterForm, filterRequestBody } from "@/app/(dashboard)/filters/filter-form";
import { FilterRow } from "@/app/(dashboard)/filters/filter-row";
import type { MessageFilter } from "@/app/(dashboard)/filters/utils";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
	vi.clearAllMocks();
	h.search = new URLSearchParams();
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(() => {
	act(() => root.unmount());
	container.remove();
});

function render(node: React.ReactNode) {
	act(() => root.render(<QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>));
}

const flush = () => act(async () => { for (let tick = 0; tick < 5; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });

function type(id: string, value: string) {
	const input = container.querySelector(`#${id}`) as HTMLInputElement | HTMLSelectElement;
	act(() => {
		const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set;
		setter?.call(input, value);
		input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
	});
}

const button = (text: string) => [...container.querySelectorAll("button")].find((b) => b.textContent?.includes(text)) as HTMLButtonElement;

describe("FilterForm (F101)", () => {
	it("prefills the sender from ?from= and posts every field", async () => {
		h.search = new URLSearchParams("from=deals@shop.test");
		h.post.mockResolvedValue({ id: "filter_9" });
		const onCreated = vi.fn();
		render(<FilterForm labels={[{ id: "lbl_1", name: "Deals", color: "#000000" }]} onCreated={onCreated} />);
		expect((container.querySelector("#filter-fromContains") as HTMLInputElement).value).toBe("deals@shop.test");

		type("filter-hasWords", "sale, coupon");
		type("filter-focus", "other");
		type("filter-label", "lbl_1");
		type("filter-actionExpireDays", "14");
		act(() => (container.querySelector("input[type=checkbox]") as HTMLInputElement).click());
		type("filter-matchMode", "any");
		await act(async () => button("createTitle").click());
		await flush();

		expect(h.post).toHaveBeenCalledWith("/api/filters", expect.objectContaining({
			name: "deals@shop.test", fromContains: "deals@shop.test", hasWords: "sale, coupon", matchMode: "any",
			actionFocus: "other", actionLabelId: "lbl_1", actionExpireDays: 14, actionStar: true,
		}));
		expect(onCreated).toHaveBeenCalledWith("filter_9");
		expect((container.querySelector("#filter-fromContains") as HTMLInputElement).value).toBe("");
	});

	it("asks for a condition instead of posting an empty filter, and reports a failed create", async () => {
		render(<FilterForm labels={[]} onCreated={vi.fn()} />);
		await act(async () => button("createTitle").click());
		expect(container.textContent).toContain("conditionRequired");
		expect(h.post).not.toHaveBeenCalled();

		h.post.mockRejectedValue(new Error("400"));
		type("filter-subjectContains", "invoice");
		await act(async () => button("createTitle").click());
		await flush();
		expect(container.textContent).toContain("createFailed");
	});

	it("omits blank optional fields and falls back to the default name", () => {
		const body = filterRequestBody({
			name: " ", fromContains: "", toContains: "me", subjectContains: "", hasWords: "", actionExpireDays: "",
			matchMode: "all", actionStar: false, actionMarkRead: false, actionArchive: false, actionMoveToTrash: false,
			actionLabelId: "", actionFocus: "",
		}, "My filter");
		expect(body).toMatchObject({ name: "My filter", toContains: "me", fromContains: undefined, actionFocus: undefined, actionExpireDays: undefined });
	});
});

const filter: MessageFilter = {
	id: "filter_1", name: "Deals", fromContains: "shop.test", toContains: null, subjectContains: null, hasWords: null,
	matchMode: "all", actionStar: false, actionMarkRead: false, actionArchive: true, actionLabelId: null,
	actionMoveToTrash: false, actionFocus: null, actionExpireDays: null, enabled: true,
};

describe("FilterRow (F101)", () => {
	it("previews, applies, and reports the count", async () => {
		h.preview.mockResolvedValue(42);
		h.apply.mockResolvedValue(42);
		render(<FilterRow filter={filter} autoPreview={false} onDelete={vi.fn()} />);
		expect(container.textContent).toContain("ifPrefix");

		await act(async () => button("applyExisting").click());
		await flush();
		expect(container.textContent).toContain('applyPreview:{"count":42}');

		await act(async () => button("applyConfirm").click());
		await flush();
		expect(h.apply).toHaveBeenCalledWith("filter_1");
		expect(container.textContent).toContain('applyDone:{"count":42}');
	});

	it("previews a just-created filter automatically, can cancel, and hides apply for zero", async () => {
		h.preview.mockResolvedValue(0);
		render(<FilterRow filter={filter} autoPreview onDelete={vi.fn()} />);
		await flush();
		expect(container.textContent).toContain('applyPreview:{"count":0}');
		expect(button("applyConfirm")).toBeUndefined();

		act(() => button("cancel").click());
		expect(container.textContent).not.toContain("applyPreview");
	});

	it("shows an error when previewing fails, including the automatic preview, and deletes", async () => {
		h.preview.mockRejectedValue(new Error("down"));
		const onDelete = vi.fn();
		render(<FilterRow filter={filter} autoPreview onDelete={onDelete} />);
		await flush();
		expect(container.textContent).toContain("applyFailed");

		await act(async () => button("applyExisting").click());
		await flush();
		expect(container.textContent).toContain("applyFailed");

		act(() => (container.querySelector("button[aria-label=deleteFilter]") as HTMLButtonElement).click());
		expect(onDelete).toHaveBeenCalledWith("filter_1");
	});

	it("ignores an automatic preview that resolves after unmounting", async () => {
		let resolve: (count: number) => void = () => {};
		h.preview.mockReturnValue(new Promise<number>((done) => { resolve = done; }));
		render(<FilterRow filter={filter} autoPreview onDelete={vi.fn()} />);
		act(() => root.render(<div />));
		await act(async () => resolve(3));
		expect(container.textContent).toBe("");
	});
});
