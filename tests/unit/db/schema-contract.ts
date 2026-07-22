import type { DatabaseSync } from "node:sqlite";
import { getTableConfig, type SQLiteTable } from "drizzle-orm/sqlite-core";

export interface ColumnContract {
	name: string;
	type: string;
	notNull: boolean;
	primaryKey: boolean;
}

export interface IndexContract {
	name: string;
	columns: string[];
	unique: boolean;
}

export interface ForeignKeyContract {
	columns: string[];
	foreignTable: string;
	foreignColumns: string[];
	onUpdate: string;
	onDelete: string;
}

export interface TableContract {
	name: string;
	columns: ColumnContract[];
	indexes: IndexContract[];
	foreignKeys: ForeignKeyContract[];
}

export interface SchemaContract {
	tables: TableContract[];
}

interface SqliteTableRow {
	name: string;
}

interface SqliteColumnRow {
	name: string;
	type: string;
	notnull: number;
	pk: number;
}

interface SqliteIndexRow {
	name: string;
	unique: number;
	origin: string;
}

interface SqliteIndexColumnRow {
	seqno: number;
	name: string;
}

interface SqliteForeignKeyRow {
	id: number;
	seq: number;
	table: string;
	from: string;
	to: string;
	on_update: string;
	on_delete: string;
}

function sortByName<T extends { name: string }>(values: T[]): T[] {
	return values.sort((left, right) => left.name.localeCompare(right.name));
}

function quoteIdentifier(identifier: string): string {
	return `"${identifier.replaceAll('"', '""')}"`;
}

function normalizeAction(action: string | undefined): string {
	return (action ?? "no action").toLowerCase();
}

function indexColumnName(column: unknown, indexName: string): string {
	if (typeof column === "object" && column !== null && "name" in column) {
		return String(column.name);
	}
	throw new Error(`Schema contract cannot inspect expression index ${indexName}`);
}

export function buildDrizzleSchemaContract(
	schema: Record<string, SQLiteTable>,
): SchemaContract {
	const tables = Object.values(schema).map((table): TableContract => {
		const config = getTableConfig(table);
		const indexes: IndexContract[] = config.indexes.map((index) => ({
			name: index.config.name,
			columns: index.config.columns.map((column) =>
				indexColumnName(column, index.config.name),
			),
			unique: index.config.unique,
		}));

		for (const column of config.columns) {
			if (column.isUnique && column.uniqueName) {
				indexes.push({ name: column.uniqueName, columns: [column.name], unique: true });
			}
		}
		for (const constraint of config.uniqueConstraints) {
			const name = constraint.getName();
			if (!name) {
				throw new Error(`Schema contract requires a name for unique constraints on ${config.name}`);
			}
			indexes.push({
				name,
				columns: constraint.columns.map((column) => column.name),
				unique: true,
			});
		}

		return {
			name: config.name,
			columns: sortByName(
				config.columns.map((column) => ({
					name: column.name,
					type: column.getSQLType().toLowerCase(),
					notNull: column.notNull,
					primaryKey: column.primary,
				})),
			),
			indexes: sortByName(indexes),
			foreignKeys: config.foreignKeys
				.map((foreignKey) => {
					const reference = foreignKey.reference();
					return {
						columns: reference.columns.map((column) => column.name),
						foreignTable: getTableConfig(reference.foreignTable).name,
						foreignColumns: reference.foreignColumns.map((column) => column.name),
						onUpdate: normalizeAction(foreignKey.onUpdate),
						onDelete: normalizeAction(foreignKey.onDelete),
					};
				})
				.sort((left, right) => foreignKeyKey(left).localeCompare(foreignKeyKey(right))),
		};
	});

	return { tables: sortByName(tables) };
}

export function readSqliteSchemaContract(database: DatabaseSync): SchemaContract {
	const tableRows = database
		.prepare(
			"SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'd1_migrations' AND name NOT LIKE '_cf_%' ORDER BY name",
		)
		.all() as unknown as SqliteTableRow[];

	const tables = tableRows.map(({ name }): TableContract => {
		const quotedTable = quoteIdentifier(name);
		const columnRows = database
			.prepare(`PRAGMA table_info(${quotedTable})`)
			.all() as unknown as SqliteColumnRow[];
		const indexRows = database
			.prepare(`PRAGMA index_list(${quotedTable})`)
			.all() as unknown as SqliteIndexRow[];
		const foreignKeyRows = database
			.prepare(`PRAGMA foreign_key_list(${quotedTable})`)
			.all() as unknown as SqliteForeignKeyRow[];

		const indexes = indexRows
			.filter((index) => index.origin !== "pk" && !index.name.startsWith("sqlite_autoindex_"))
			.map((index): IndexContract => {
				const columns = database
					.prepare(`PRAGMA index_info(${quoteIdentifier(index.name)})`)
					.all() as unknown as SqliteIndexColumnRow[];
				return {
					name: index.name,
					columns: columns.sort((left, right) => left.seqno - right.seqno).map((column) => column.name),
					unique: index.unique === 1,
				};
			});

		const foreignKeyGroups = Map.groupBy(foreignKeyRows, (row) => row.id);
		const foreignKeys = [...foreignKeyGroups.values()].map((rows): ForeignKeyContract => {
			const ordered = rows.sort((left, right) => left.seq - right.seq);
			return {
				columns: ordered.map((row) => row.from),
				foreignTable: ordered[0].table,
				foreignColumns: ordered.map((row) => row.to),
				onUpdate: normalizeAction(ordered[0].on_update),
				onDelete: normalizeAction(ordered[0].on_delete),
			};
		});

		return {
			name,
			columns: sortByName(
				columnRows.map((column) => ({
					name: column.name,
					type: column.type.toLowerCase(),
					notNull: column.notnull === 1 || column.pk > 0,
					primaryKey: column.pk > 0,
				})),
			),
			indexes: sortByName(indexes),
			foreignKeys: foreignKeys.sort((left, right) =>
				foreignKeyKey(left).localeCompare(foreignKeyKey(right)),
			),
		};
	});

	return { tables: sortByName(tables) };
}

function foreignKeyKey(foreignKey: ForeignKeyContract): string {
	return `${foreignKey.columns.join(",")}->${foreignKey.foreignTable}.${foreignKey.foreignColumns.join(",")}|${foreignKey.onUpdate}|${foreignKey.onDelete}`;
}

function foreignKeyDescription(table: string, foreignKey: ForeignKeyContract): string {
	return `${table}.(${foreignKey.columns.join(",")}) -> ${foreignKey.foreignTable}.(${foreignKey.foreignColumns.join(",")}) [update ${foreignKey.onUpdate}, delete ${foreignKey.onDelete}]`;
}

export function diffSchemaContracts(
	expected: SchemaContract,
	actual: SchemaContract,
): string[] {
	const differences: string[] = [];
	const expectedTables = new Map(expected.tables.map((table) => [table.name, table]));
	const actualTables = new Map(actual.tables.map((table) => [table.name, table]));

	for (const table of expected.tables) {
		if (!actualTables.has(table.name)) differences.push(`Missing table: ${table.name}`);
	}
	for (const table of actual.tables) {
		if (!expectedTables.has(table.name)) differences.push(`Unexpected table: ${table.name}`);
	}

	for (const expectedTable of expected.tables) {
		const actualTable = actualTables.get(expectedTable.name);
		if (!actualTable) continue;

		const expectedColumns = new Map(expectedTable.columns.map((column) => [column.name, column]));
		const actualColumns = new Map(actualTable.columns.map((column) => [column.name, column]));
		for (const column of expectedTable.columns) {
			const actualColumn = actualColumns.get(column.name);
			if (!actualColumn) {
				differences.push(`Missing column: ${expectedTable.name}.${column.name}`);
			} else if (
				column.type !== actualColumn.type ||
				column.notNull !== actualColumn.notNull ||
				column.primaryKey !== actualColumn.primaryKey
			) {
				differences.push(
					`Changed column: ${expectedTable.name}.${column.name} (expected ${column.type}, notNull=${column.notNull}, primaryKey=${column.primaryKey}; actual ${actualColumn.type}, notNull=${actualColumn.notNull}, primaryKey=${actualColumn.primaryKey})`,
				);
			}
		}
		for (const column of actualTable.columns) {
			if (!expectedColumns.has(column.name)) {
				differences.push(`Unexpected column: ${expectedTable.name}.${column.name}`);
			}
		}

		const expectedIndexes = new Map(expectedTable.indexes.map((index) => [index.name, index]));
		const actualIndexes = new Map(actualTable.indexes.map((index) => [index.name, index]));
		for (const index of expectedTable.indexes) {
			const actualIndex = actualIndexes.get(index.name);
			if (!actualIndex) {
				differences.push(`Missing index: ${expectedTable.name}.${index.name}`);
			} else if (
				index.unique !== actualIndex.unique ||
				index.columns.join(",") !== actualIndex.columns.join(",")
			) {
				differences.push(
					`Changed index: ${expectedTable.name}.${index.name} (expected unique=${index.unique} columns=(${index.columns.join(",")}); actual unique=${actualIndex.unique} columns=(${actualIndex.columns.join(",")}))`,
				);
			}
		}
		for (const index of actualTable.indexes) {
			if (!expectedIndexes.has(index.name)) {
				differences.push(`Unexpected index: ${expectedTable.name}.${index.name}`);
			}
		}

		const expectedForeignKeys = new Map(
			expectedTable.foreignKeys.map((foreignKey) => [foreignKeyKey(foreignKey), foreignKey]),
		);
		const actualForeignKeys = new Map(
			actualTable.foreignKeys.map((foreignKey) => [foreignKeyKey(foreignKey), foreignKey]),
		);
		for (const [key, foreignKey] of expectedForeignKeys) {
			if (!actualForeignKeys.has(key)) {
				differences.push(
					`Missing foreign key: ${foreignKeyDescription(expectedTable.name, foreignKey)}`,
				);
			}
		}
		for (const [key, foreignKey] of actualForeignKeys) {
			if (!expectedForeignKeys.has(key)) {
				differences.push(
					`Unexpected foreign key: ${foreignKeyDescription(expectedTable.name, foreignKey)}`,
				);
			}
		}
	}

	return differences;
}
