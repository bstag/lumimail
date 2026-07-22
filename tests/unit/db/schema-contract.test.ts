import { describe, expect, it } from "vitest";
import { diffSchemaContracts, type SchemaContract } from "./schema-contract";

const complete: SchemaContract = {
	tables: [
		{
			name: "children",
			columns: [
				{ name: "id", type: "text", notNull: true, primaryKey: true },
				{ name: "parent_id", type: "text", notNull: true, primaryKey: false },
			],
			indexes: [{ name: "children_parent_idx", columns: ["parent_id"], unique: false }],
			foreignKeys: [
				{
					columns: ["parent_id"],
					foreignTable: "parents",
					foreignColumns: ["id"],
					onUpdate: "no action",
					onDelete: "cascade",
				},
			],
		},
	],
};

describe("schema contract differences", () => {
	const missingCases: Array<[string, SchemaContract, string]> = [
		["table", { tables: [] }, "Missing table: children"],
		[
			"column",
			{ tables: [{ ...complete.tables[0], columns: complete.tables[0].columns.slice(0, 1) }] },
			"Missing column: children.parent_id",
		],
		[
			"index",
			{ tables: [{ ...complete.tables[0], indexes: [] }] },
			"Missing index: children.children_parent_idx",
		],
		[
			"foreign key",
			{ tables: [{ ...complete.tables[0], foreignKeys: [] }] },
			"Missing foreign key: children.(parent_id) -> parents.(id) [update no action, delete cascade]",
		],
	];

	it.each(missingCases)("reports a missing %s", (_kind, actual, message) => {
		expect(diffSchemaContracts(complete, actual)).toContain(message);
	});

	it("reports unexpected and changed structures", () => {
		const actual: SchemaContract = {
			tables: [
				{
					...complete.tables[0],
					columns: [
						{ ...complete.tables[0].columns[0], type: "integer" },
						complete.tables[0].columns[1],
						{ name: "extra", type: "text", notNull: false, primaryKey: false },
					],
					indexes: [
						{ ...complete.tables[0].indexes[0], unique: true },
						{ name: "unexpected_idx", columns: ["extra"], unique: false },
					],
					foreignKeys: [
						{ ...complete.tables[0].foreignKeys[0], onDelete: "restrict" },
					],
				},
				{ name: "unexpected", columns: [], indexes: [], foreignKeys: [] },
			],
		};

		expect(diffSchemaContracts(complete, actual)).toEqual([
			"Unexpected table: unexpected",
			"Changed column: children.id (expected text, notNull=true, primaryKey=true; actual integer, notNull=true, primaryKey=true)",
			"Unexpected column: children.extra",
			"Changed index: children.children_parent_idx (expected unique=false columns=(parent_id); actual unique=true columns=(parent_id))",
			"Unexpected index: children.unexpected_idx",
			"Missing foreign key: children.(parent_id) -> parents.(id) [update no action, delete cascade]",
			"Unexpected foreign key: children.(parent_id) -> parents.(id) [update no action, delete restrict]",
		]);
	});
});
