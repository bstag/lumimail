// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
	preview: vi.fn(), run: vi.fn(), dismissed: false, writeDismissed: vi.fn(),
	groups: vi.fn(), senderMessages: vi.fn(), grouped: false, runIds: vi.fn(),
}));
vi.mock("next-intl", () => ({
	useTranslations: () => (key: string, values?: Record<string, unknown>) => values ? `${key}:${JSON.stringify(values)}` : key,
}));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("@/components/messages/bulk-cleanup-utils", async (importOriginal) => ({
	...(await importOriginal<object>()),
	previewViewAction: h.preview, runViewAction: h.run,
	readBacklogDismissed: () => h.dismissed, writeBacklogDismissed: h.writeDismissed,
}));
vi.mock("@/components/messages/utils", async (importOriginal) => ({
	...(await importOriginal<object>()), runBulkMessageAction: h.runIds,
}));
vi.mock("@/components/messages/sender-groups-utils", async (importOriginal) => ({
	...(await importOriginal<object>()),
	fetchSenderGroups: h.groups, fetchSenderMessages: h.senderMessages,
	readGroupBySender: () => h.grouped, writeGroupBySender: (next: boolean) => { h.grouped = next; },
	subscribeGroupBySender: () => () => {},
}));

import { CleanUpMenu, OtherBacklogPrompt, SelectAllInViewBar, useSelectAllInView } from "@/components/messages/bulk-cleanup";
import { GroupBySenderToggle, SenderGroups, useGroupBySender } from "@/components/messages/sender-groups";
import { FolderListBody, useFolderViewActions } from "@/components/messages/folder-view-actions";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
	vi.clearAllMocks();
	h.dismissed = false;
	h.grouped = false;
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(() => {
	act(() => root.unmount());
	container.remove();
});

function render(node: React.ReactNode) {
	act(() => root.render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>));
}

// React Query delivers results on a later tick; give it a few.
const flush = () => act(async () => { for (let tick = 0; tick < 5; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
const button = (text: string) => [...container.querySelectorAll("button")].find((b) => b.textContent?.includes(text)) as HTMLButtonElement;
const view = { direction: "inbound", status: "received", focus: "other" };

describe("SelectAllInViewBar and useSelectAllInView (F102)", () => {
	function Harness({ allVisibleSelected, query }: { allVisibleSelected: boolean; query: Record<string, string> }) {
		const selection = useSelectAllInView(query, allVisibleSelected);
		return <SelectAllInViewBar allVisibleSelected={allVisibleSelected} pageCount={25} total={300} allInView={selection.allInView}
			onSelectAll={selection.selectAll} onClear={selection.clear} />;
	}

	it("widens to the whole view, and resets when the page or view changes", () => {
		render(<Harness allVisibleSelected query={view} />);
		expect(container.textContent).toContain('pageSelected:{"count":25}');
		act(() => button("selectAllInView").click());
		expect(container.textContent).toContain('allInViewSelected:{"total":300}');

		render(<Harness allVisibleSelected query={{ ...view, focus: "focused" }} />);
		expect(container.textContent).toContain("pageSelected");

		render(<Harness allVisibleSelected query={view} />);
		act(() => button("selectAllInView").click());
		act(() => button("clearSelection").click());
		expect(container.textContent).toContain("pageSelected");

		act(() => button("selectAllInView").click());
		render(<Harness allVisibleSelected={false} query={view} />);
		expect(container.textContent).toBe("");
		render(<Harness allVisibleSelected query={view} />);
		expect(container.textContent).toContain("pageSelected");
	});

	it("stays hidden when the page already holds the whole view", () => {
		render(<SelectAllInViewBar allVisibleSelected pageCount={25} total={25} allInView={false} onSelectAll={vi.fn()} onClear={vi.fn()} />);
		expect(container.textContent).toBe("");
	});
});

describe("CleanUpMenu (F102)", () => {
	function choose(days: string) {
		const select = container.querySelector("select") as HTMLSelectElement;
		return act(async () => {
			select.value = days;
			select.dispatchEvent(new Event("change", { bubbles: true }));
		});
	}

	it("previews an age, archives after confirming, and reports the count", async () => {
		h.preview.mockResolvedValue(120);
		h.run.mockResolvedValue(120);
		render(<CleanUpMenu query={view} />);
		await choose("30");
		await flush();
		expect(h.preview).toHaveBeenCalledWith({ ...view, olderThanDays: "30" }, "archive");
		expect(container.textContent).toContain('cleanUpConfirm:{"count":120,"days":30}');

		await act(async () => button("archiveNow").click());
		await flush();
		expect(h.run).toHaveBeenCalledWith(expect.anything(), { ...view, olderThanDays: "30" }, "archive");
		expect(container.textContent).toContain('cleanUpDone:{"count":120}');
	});

	it("ignores the placeholder, hides Archive for zero, cancels, and reports failures", async () => {
		render(<CleanUpMenu query={view} />);
		await choose("");
		expect(h.preview).not.toHaveBeenCalled();

		h.preview.mockResolvedValueOnce(0);
		await choose("7");
		await flush();
		expect(button("archiveNow")).toBeUndefined();
		act(() => button("cancel").click());
		expect(container.textContent).not.toContain("cleanUpConfirm");

		h.preview.mockRejectedValueOnce(new Error("down"));
		await choose("90");
		await flush();
		expect(container.textContent).toContain("cleanUpFailed");
	});
});

describe("OtherBacklogPrompt (F102)", () => {
	it("offers to archive a large week-old backlog and dismisses itself afterwards", async () => {
		h.preview.mockResolvedValue(450);
		h.run.mockResolvedValue(450);
		render(<OtherBacklogPrompt query={view} />);
		await flush();
		expect(container.textContent).toContain('backlogPrompt:{"count":450}');

		await act(async () => button("backlogArchive").click());
		await flush();
		expect(h.run).toHaveBeenCalledWith(expect.anything(), { ...view, olderThanDays: "7" }, "archive");
		expect(h.writeDismissed).toHaveBeenCalled();
		expect(container.textContent).toBe("");
	});

	it("stays hidden for a small backlog or once dismissed, and survives a failed archive", async () => {
		h.preview.mockResolvedValue(50);
		render(<OtherBacklogPrompt query={view} />);
		await flush();
		expect(container.textContent).toBe("");

		h.dismissed = true;
		render(<OtherBacklogPrompt query={{ ...view, q: "x" }} />);
		expect(container.textContent).toBe("");

		act(() => root.unmount());
		root = createRoot(container);
		h.dismissed = false;
		h.preview.mockResolvedValue(500);
		h.run.mockRejectedValue(new Error("down"));
		render(<OtherBacklogPrompt query={view} />);
		await flush();
		await act(async () => button("backlogArchive").click());
		await flush();
		expect(container.textContent).toContain("backlogPrompt");

		act(() => button("notNow").click());
		expect(container.textContent).toBe("");
	});
});

describe("Group by sender (F103)", () => {
	const groups = {
		total: 30,
		senders: [
			{ sender: "deals@shop.test", fromAddr: "Shop <deals@shop.test>", count: 12, unread: 3, latestId: "m1", latestSubject: "Sale", latestAt: "2026-11-08T10:00:00.000Z" },
			{ sender: "news@paper.test", fromAddr: "news@paper.test", count: 1, unread: 0, latestId: "m2", latestSubject: null, latestAt: "2026-11-07T10:00:00.000Z" },
		],
	};

	function Toggle() {
		const [value, change] = useGroupBySender();
		return <GroupBySenderToggle value={value} onChange={change} />;
	}

	it("toggles the stored choice", () => {
		render(<Toggle />);
		act(() => (container.querySelector("input[type=checkbox]") as HTMLInputElement).click());
		expect(h.grouped).toBe(true);
	});

	it("lists senders, expands one, archives all, links to a filter, and pages", async () => {
		h.groups.mockResolvedValue(groups);
		h.senderMessages.mockResolvedValue([
			{ id: "m1", subject: "Sale", read: false, createdAt: "2026-11-08T10:00:00.000Z" },
			{ id: "m0", subject: null, read: true, createdAt: "2026-11-01T10:00:00.000Z" },
		]);
		h.run.mockResolvedValue(12);
		render(<SenderGroups view={view} />);
		expect(container.textContent).toContain("loading");
		await flush();
		expect(container.textContent).toContain("Sale");
		expect(container.querySelector('a[href="/filters?from=deals%40shop.test"]')).not.toBeNull();

		const expand = container.querySelector("button[aria-expanded]") as HTMLButtonElement;
		act(() => expand.click());
		expect(container.textContent).toContain("loading");
		await flush();
		expect(container.querySelector('a[href="/inbox/m0"]')).not.toBeNull();
		act(() => expand.click());
		expect(container.querySelector('a[href="/inbox/m0"]')).toBeNull();

		const archive = [...container.querySelectorAll("button")].find((b) => b.getAttribute("aria-label")?.startsWith("archiveSenderNamed")) as HTMLButtonElement;
		await act(async () => archive.click());
		expect(h.run).toHaveBeenCalledWith(expect.anything(), { ...view, sender: "deals@shop.test" }, "archive");

		await act(async () => button("moreSenders").click());
		await flush();
		expect(h.groups).toHaveBeenLastCalledWith(view, 50);
	});

	it("re-enables archive after a failure and shows empty and error states", async () => {
		h.groups.mockResolvedValueOnce({ total: 1, senders: [groups.senders[1]] });
		h.run.mockRejectedValue(new Error("down"));
		render(<SenderGroups view={view} />);
		await flush();
		expect(button("moreSenders")).toBeUndefined();
		const archive = [...container.querySelectorAll("button")].find((b) => b.getAttribute("aria-label")?.startsWith("archiveSenderNamed")) as HTMLButtonElement;
		await act(async () => archive.click());
		await flush();
		expect(archive.disabled).toBe(false);

		h.groups.mockResolvedValueOnce({ total: 0, senders: [] });
		render(<SenderGroups view={{ ...view, q: "none" }} />);
		await flush();
		expect(container.textContent).toContain("noMessagesFilter");

		h.groups.mockRejectedValueOnce(new Error("down"));
		render(<SenderGroups view={{ ...view, q: "broken" }} />);
		await flush();
		expect(container.textContent).toContain("sendersFailed");
	});
});

describe("useFolderViewActions (F102, F103)", () => {
	let actions: ReturnType<typeof useFolderViewActions> | null = null;
	function Harness({ selectedIds, focus }: { selectedIds: string[]; focus?: "focused" | "other" }) {
		actions = useFolderViewActions({
			folder: "inbox", mailboxId: "mbx_1", query: "", labelId: null, focus,
			messageIds: ["a", "b"], selectedIds, total: 80,
		});
		return <FolderListBody grouped={actions.grouped} view={actions.view}><p>flat list</p></FolderListBody>;
	}

	it("acts on the selected ids, or on the whole view once selected, and groups only the Inbox", async () => {
		h.run.mockResolvedValue(80);
		h.runIds.mockResolvedValue(undefined);
		render(<Harness selectedIds={["a"]} focus="focused" />);
		expect(actions?.allVisibleSelected).toBe(false);
		expect(actions?.selectedCount).toBe(1);
		await act(async () => { await actions?.run("archive"); });
		expect(h.runIds).toHaveBeenCalledWith(expect.anything(), ["a"], "archive");

		render(<Harness selectedIds={["a", "b"]} focus="focused" />);
		act(() => actions?.selection.selectAll());
		expect(actions?.selectedCount).toBe(80);
		await act(async () => { await actions?.run("read"); });
		expect(h.run).toHaveBeenCalledWith(expect.anything(), { direction: "inbound", status: "received", mailboxId: "mbx_1", focus: "focused" }, "read");

		h.grouped = true;
		h.groups.mockResolvedValue({ total: 0, senders: [] });
		render(<Harness selectedIds={[]} />);
		expect(actions?.grouped).toBe(false);
		expect(container.textContent).toContain("flat list");
		render(<Harness selectedIds={[]} focus="other" />);
		expect(actions?.grouped).toBe(true);
		expect(container.textContent).not.toContain("flat list");
	});
});
