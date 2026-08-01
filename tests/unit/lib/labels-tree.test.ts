import { describe, expect, it } from "vitest";
import { buildLabelTree, type LabelRecord } from "@/lib/labels-tree";

const label = (id: string, name: string, parentId: string | null = null): LabelRecord => ({
	id,
	name,
	color: "#6366f1",
	parentId,
});

describe("buildLabelTree", () => {
	it("nests children under their parent, each sorted by name", () => {
		const tree = buildLabelTree([
			label("l_work", "Work"),
			label("l_northline", "Northline", "l_clients"),
			label("l_clients", "Clients"),
			label("l_acme", "Acme", "l_clients"),
		]);

		expect(tree.map((node) => node.name)).toEqual(["Clients", "Work"]);
		expect(tree[0].children.map((child) => child.name)).toEqual(["Acme", "Northline"]);
		expect(tree[1].children).toEqual([]);
	});

	it("treats a child whose parent is missing as top level", () => {
		// The parent may have been deleted between the nav's label fetch and this
		// render. Dropping the child would hide mail; promoting it does not.
		const tree = buildLabelTree([label("l_orphan", "Orphan", "l_gone")]);

		expect(tree.map((node) => node.name)).toEqual(["Orphan"]);
		expect(tree[0].children).toEqual([]);
	});

	it("does not nest a grandchild below the second level", () => {
		// The API rejects this, but a row written before that rule existed must
		// still render somewhere rather than vanishing.
		const tree = buildLabelTree([
			label("l_a", "A"),
			label("l_b", "B", "l_a"),
			label("l_c", "C", "l_b"),
		]);

		const names = tree.flatMap((node) => [node.name, ...node.children.map((c) => c.name)]);
		expect(names).toContain("C");
		expect(tree.find((node) => node.name === "A")?.children.map((c) => c.name)).toEqual(["B"]);
	});

	it("sorts case-insensitively so casing does not scatter related labels", () => {
		const tree = buildLabelTree([label("l_1", "zeta"), label("l_2", "Alpha")]);
		expect(tree.map((node) => node.name)).toEqual(["Alpha", "zeta"]);
	});

	it("returns an empty array for no labels", () => {
		expect(buildLabelTree([])).toEqual([]);
	});
});
