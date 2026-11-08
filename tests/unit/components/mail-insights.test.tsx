// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG } from "@/lib/categorization/engine";

const h = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }));
vi.mock("@/lib/api/client-response", () => ({ apiJson: h }));
vi.mock("@/components/mailbox-provider", () => ({
	useSelectedMailbox: () => ({ scopedMailboxId: null, isLoading: false }),
}));
vi.mock("next/link", () => ({
	default: ({ children, href, ...props }: React.ComponentProps<"a">) => (
		<a href={href} {...props}>
			{children}
		</a>
	),
}));
import MailInsightsPage from "@/app/(dashboard)/insights/page";

let container: HTMLDivElement;
let root: Root;
let client: QueryClient;
const evaluation = {
	tags: [{ tag: "Newsletters", reason: "Email type" }],
	uncertain: [],
	answers: {},
	model: "rules",
};
const settings = {
	activeVersion: "v1",
	automatic: false,
	configured: true,
	config: DEFAULT_CONFIG,
	versions: [
		{ id: "v1", createdAt: "2026-10-02T12:00:00Z", config: DEFAULT_CONFIG },
	],
};
const mail = {
	id: "m1",
	subject: "Daily brief",
	fromAddr: "digest@brief.example",
	tags: ["Newsletters"],
	correction: ["Newsletters"],
	versionId: "v1",
	evaluation,
};
const insights = {
	total: 1,
	senders: [{ sender: "digest@brief.example", total: 1 }],
	offset: 0,
	hasMore: false,
	tags: [{ id: "l1", name: "Newsletters", total: 1 }],
	weekly: [{ week: "2026-39", total: 1 }],
	messages: [mail],
};
const jobs = [
	{
		id: "j1",
		versionId: "v1",
		mailboxId: null,
		automatic: false,
		status: "pending",
		processed: 0,
		error: null,
	},
	{
		id: "j2",
		versionId: "v1",
		mailboxId: "mb1",
		automatic: true,
		status: "failed",
		processed: 5,
		error: "Retry classification",
	},
];
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
async function click(text: string) {
	const button = [...container.querySelectorAll("button")].find(
		(b) => b.textContent === text,
	);
	if (!button) throw new Error(`Missing button ${text}`);
	await act(async () => {
		button.click();
		await tick();
	});
	await act(tick);
}
async function render() {
	await act(async () => {
		root.render(
			<QueryClientProvider client={client}>
				<MailInsightsPage />
			</QueryClientProvider>,
		);
		await tick();
	});
	await act(tick);
}
async function changeField(label: string, value: string) {
	const wrapper = [...container.querySelectorAll("label")].find(
		(item) => item.firstChild?.textContent?.trim() === label,
	);
	const field = wrapper?.querySelector("input,textarea,select");
	if (!field) throw new Error(`Missing field ${label}`);
	const prototype = Object.getPrototypeOf(field);
	await act(async () => {
		Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(
			field,
			value,
		);
		field.dispatchEvent(
			new Event(field.tagName === "SELECT" ? "change" : "input", {
				bubbles: true,
			}),
		);
	});
}
beforeEach(() => {
	vi.clearAllMocks();
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	container = document.createElement("div");
	window.document.body.appendChild(container);
	root = createRoot(container);
	h.get.mockImplementation(async (url: string) =>
		url === "/api/categorization"
			? settings
			: url === "/api/categorization/jobs"
				? jobs
				: insights,
	);
	h.post.mockImplementation(async (url: string) =>
		url.endsWith("/preview")
			? [
					{
						messageId: "m1",
						subject: "Daily brief",
						current: ["Updates"],
						correction: [],
						proposed: evaluation,
					},
				]
			: settings,
	);
	h.patch.mockResolvedValue({});
});
afterEach(async () => {
	await act(async () => root.unmount());
	client.clear();
	container.remove();
});

describe("Mail insights interactive view", () => {
	it("tests local rules without a provider key or AI disclosure consent", async () => {
		const local = {
			...settings,
			activeVersion: null,
			configured: false,
			versions: [],
			config: { ...DEFAULT_CONFIG, questions: [], rules: [] },
		};
		h.get.mockImplementation(async (url: string) =>
			url === "/api/categorization" ? local : insights,
		);
		h.post.mockResolvedValue([]);
		await render();
		await click("Questions & rules");
		expect(container.textContent).toContain("Jev is not configured");
		await click("Test on recent mail");
		expect(h.post).toHaveBeenCalledWith("/api/categorization/preview", {
			config: local.config,
			mailboxId: null,
			consent: true,
		});
		expect(container.textContent).toContain(
			"No eligible received mail in this scope",
		);
		await click("Activate configuration");
		expect(h.post).toHaveBeenCalledWith("/api/categorization", {
			config: local.config,
			expectedVersion: null,
			automatic: false,
			consent: false,
		});
	});
	it("renders sender/date/tag insights and supports personal correction actions", async () => {
		await render();
		expect(container.textContent).toContain("1 received messages");
		expect(container.querySelector('a[href="/inbox/m1"]')).not.toBeNull();
		await click("Save correction");
		expect(h.post).toHaveBeenCalledWith("/api/categorization/corrections", {
			messageId: "m1",
			tags: ["Newsletters"],
		});
		await click("Restore automatic tags");
		expect(h.post).toHaveBeenCalledWith("/api/categorization/corrections", {
			messageId: "m1",
			tags: null,
		});
		await click("digest@brief.example");
		expect(container.textContent).toContain("All senders");
		await click("All senders");
	});
	it("requires consent for AI previews and activates editable questions", async () => {
		await render();
		await click("Questions & rules");
		expect(container.textContent).toContain("Questions sent to Jev");
		const preview = [...container.querySelectorAll("button")].find(
			(b) => b.textContent === "Test on recent mail",
		)!;
		expect(preview.disabled).toBe(true);
		const consent = [...container.querySelectorAll("label")]
			.find((l) => l.textContent?.startsWith("I agree"))!
			.querySelector("input")!;
		await act(async () => {
			consent.click();
			await tick();
		});
		expect(preview.disabled).toBe(false);
		await click("Test on recent mail");
		expect(h.post).toHaveBeenCalledWith("/api/categorization/preview", {
			config: DEFAULT_CONFIG,
			mailboxId: null,
			consent: true,
		});
		expect(container.textContent).toContain("Proposed: Newsletters");
		await click("Activate configuration");
		expect(h.post).toHaveBeenCalledWith("/api/categorization", {
			config: DEFAULT_CONFIG,
			expectedVersion: "v1",
			automatic: false,
			consent: true,
		});
		await click("Add question");
		expect(container.textContent).toContain("New question");
		await click("Add rule");
		expect(
			[...container.querySelectorAll("button")].find(
				(button) => button.textContent === "Activate configuration",
			)?.disabled,
		).toBe(true);
	});
	it("starts batches, retries failures, and cancels pending jobs", async () => {
		await render();
		await click("Processing");
		await act(tick);
		expect(container.textContent).toContain("Retry classification");
		await click("Reclassify existing mail");
		expect(h.post).toHaveBeenCalledWith("/api/categorization/jobs", {
			mailboxId: null,
		});
		await click("Process next batch");
		expect(h.post).toHaveBeenCalledWith("/api/categorization/jobs/j1", {
			retry: false,
		});
		await click("Retry job");
		expect(h.post).toHaveBeenCalledWith("/api/categorization/jobs/j2", {
			retry: true,
		});
		await click("Cancel job");
		expect(h.patch).toHaveBeenCalledWith("/api/categorization/jobs/j1", {
			cancel: true,
		});
	});
	it("restores old drafts and supports question and rule editing/removal", async () => {
		await render();
		await click("Questions & rules");
		await changeField("Model version", "jev-latest");
		await changeField("Question name", "Edited type");
		expect(container.textContent).toContain("Edited type");
		await changeField("Previous configuration", "v1");
		await click("Restore as draft");
		expect(container.textContent).not.toContain("Edited type");
		await click("Remove question");
		expect(container.querySelectorAll('input[type="number"]')).toHaveLength(2);
		await click("Add rule");
		await changeField("Sender", "digest@brief.example");
		await changeField("Apply tag", "Reading");
		await changeField("Rule name", "Reading list");
		expect(container.textContent).toContain("Reading list");
		const automatic = [...container.querySelectorAll("label")]
			.find((label) => label.textContent?.includes("Automatically classify"))!
			.querySelector("input")!;
		await act(async () => automatic.click());
		expect(
			[...container.querySelectorAll("button")].find(
				(button) => button.textContent === "Activate configuration",
			)?.disabled,
		).toBe(true);
		await click("Remove rule");
		expect(container.textContent).not.toContain("Reading list");
	});
});
