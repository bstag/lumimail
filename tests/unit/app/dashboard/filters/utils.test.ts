import { beforeEach, describe, expect, it, vi } from "vitest";

const authFetch = vi.fn();
vi.mock("@/lib/auth/client", () => ({ authFetch: (...args: unknown[]) => authFetch(...args) }));

import { fetchFilterLabels, fetchMessageFilters } from "@/app/(dashboard)/filters/utils";

beforeEach(() => authFetch.mockReset());

describe("filter page requests", () => {
	it("unwraps the filter collection", async () => {
		const filters = [{ id: "filter_1", name: "Invoices" }];
		authFetch.mockResolvedValue(Response.json({ success: true, data: { filters } }));
		await expect(fetchMessageFilters()).resolves.toEqual(filters);
	});

	it("unwraps the label array returned by the labels endpoint", async () => {
		const labels = [{ id: "label_1", name: "Finance", color: "#000000" }];
		authFetch.mockResolvedValue(Response.json({ success: true, data: labels }));
		await expect(fetchFilterLabels()).resolves.toEqual(labels);
	});
});
