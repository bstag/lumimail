import { describe, expect, it } from "vitest";
import { getMessageQueryParams, LABEL_VISIBLE_STATUSES } from "@/hooks/utils";

describe("label folder query params", () => {
	it("filters by label across folders without constraining direction", () => {
		const params = getMessageQueryParams("label", "mb_1", { labelId: "lbl_1" });

		expect(params.get("labelId")).toBe("lbl_1");
		expect(params.get("direction")).toBeNull();
		expect(params.get("mailboxId")).toBe("mb_1");
	});

	it("excludes trash and spam from a label view", () => {
		// A label is a filing destination. Mail the user deleted still carries the
		// label, but showing it there would make the label look like it holds
		// things the user thought they had thrown away.
		const statuses = getMessageQueryParams("label", null, { labelId: "lbl_1" })
			.get("status")
			?.split(",");

		expect(statuses).toEqual([...LABEL_VISIBLE_STATUSES]);
		expect(statuses).not.toContain("trash");
		expect(statuses).not.toContain("spam");
	});

	it("omits the mailbox filter when no mailbox is scoped", () => {
		const params = getMessageQueryParams("label", null, { labelId: "lbl_1" });
		expect(params.get("mailboxId")).toBeNull();
	});
});
