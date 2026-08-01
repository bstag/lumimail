import { describe, expect, it } from "vitest";
import { getLabelParentError } from "@/app/api/labels/utils";

/**
 * F75 §5. These rules need a database read, so they cannot live in Zod; this is
 * the pure core the route handlers call once they have done the lookups.
 */
describe("getLabelParentError", () => {
	it("allows a top-level parent", () => {
		expect(
			getLabelParentError({
				labelId: "l_child",
				parentId: "l_parent",
				parent: { id: "l_parent", parentId: null },
				hasChildren: false,
			}),
		).toBeNull();
	});

	it("reports a parent that does not exist or belongs to someone else as not found", () => {
		// 404 rather than 403: a 403 would confirm the id exists.
		expect(
			getLabelParentError({
				labelId: "l_child",
				parentId: "l_missing",
				parent: null,
				hasChildren: false,
			}),
		).toEqual({ message: "Label not found", status: 404 });
	});

	it("rejects a label as its own parent", () => {
		expect(
			getLabelParentError({
				labelId: "l_self",
				parentId: "l_self",
				parent: { id: "l_self", parentId: null },
				hasChildren: false,
			}),
		).toEqual({ message: "A label cannot be its own parent", status: 400 });
	});

	it("rejects nesting more than one level deep", () => {
		expect(
			getLabelParentError({
				labelId: "l_child",
				parentId: "l_mid",
				parent: { id: "l_mid", parentId: "l_top" },
				hasChildren: false,
			}),
		).toEqual({ message: "Labels nest one level deep", status: 400 });
	});

	it("rejects giving a parent to a label that already has children", () => {
		// Otherwise those children would sit at a third level.
		expect(
			getLabelParentError({
				labelId: "l_mid",
				parentId: "l_top",
				parent: { id: "l_top", parentId: null },
				hasChildren: true,
			}),
		).toEqual({ message: "Move this label's children first", status: 400 });
	});

	it("allows a parent on creation, where there is no label id yet", () => {
		expect(
			getLabelParentError({
				parentId: "l_parent",
				parent: { id: "l_parent", parentId: null },
				hasChildren: false,
			}),
		).toBeNull();
	});
});
