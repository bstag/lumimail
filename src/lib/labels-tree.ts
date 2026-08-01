/**
 * Sidebar shape for the user's labels (F75).
 *
 * Nesting is one level deep by rule, enforced by the label routes. This builder
 * is deliberately tolerant of data that breaks that rule anyway — a row written
 * before the rule existed, or a child whose parent was deleted between the nav's
 * fetch and this render. Anything it cannot place under a known top-level parent
 * is promoted to top level rather than dropped, because dropping it would hide
 * mail the user filed on purpose.
 */

export type LabelRecord = {
	id: string;
	name: string;
	color: string;
	parentId: string | null;
};

export type LabelNode = LabelRecord & { children: LabelRecord[] };

function byName(a: LabelRecord, b: LabelRecord): number {
	return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

export function buildLabelTree(labels: LabelRecord[]): LabelNode[] {
	// A parent is only a parent if it is itself top level. That single rule
	// collapses both the grandchild case and the missing-parent case: neither
	// resolves here, so both fall through to top level below.
	const topLevelIds = new Set(
		labels.filter((label) => label.parentId === null).map((label) => label.id),
	);

	const nodes = new Map<string, LabelNode>();
	for (const label of labels) {
		if (label.parentId === null || !topLevelIds.has(label.parentId)) {
			nodes.set(label.id, { ...label, children: [] });
		}
	}

	for (const label of labels) {
		if (label.parentId === null) continue;
		const parent = nodes.get(label.parentId);
		if (parent) parent.children.push(label);
	}

	const tree = [...nodes.values()].sort(byName);
	for (const node of tree) node.children.sort(byName);
	return tree;
}
