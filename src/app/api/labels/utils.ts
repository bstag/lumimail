/**
 * Parent-label rules for F75.
 *
 * These need database reads (does the parent exist, is it mine, does it have a
 * parent of its own, do I have children), so they cannot be expressed in the Zod
 * schema. The route handlers do the reads and hand the results here; this stays
 * a pure function so every branch is directly testable.
 */

export type LabelParentCheck = {
	/** The label being updated. Omitted on create — there is no id yet. */
	labelId?: string;
	/** The requested parent id. */
	parentId: string;
	/** The parent row, already filtered to the caller's own labels, or null. */
	parent: { id: string; parentId: string | null } | null;
	/** Whether the label being updated is itself a parent. */
	hasChildren: boolean;
};

export type LabelParentError = { message: string; status: 400 | 404 };

export function getLabelParentError(check: LabelParentCheck): LabelParentError | null {
	// Checked before the lookup result so self-parenting reports itself rather
	// than surfacing as whatever the row's own parent state happens to imply.
	if (check.labelId !== undefined && check.parentId === check.labelId) {
		return { message: "A label cannot be its own parent", status: 400 };
	}

	// 404 rather than 403: a 403 would confirm that someone else's label id exists.
	if (!check.parent) {
		return { message: "Label not found", status: 404 };
	}

	if (check.parent.parentId !== null) {
		return { message: "Labels nest one level deep", status: 400 };
	}

	if (check.hasChildren) {
		return { message: "Move this label's children first", status: 400 };
	}

	return null;
}
