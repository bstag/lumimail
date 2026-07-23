import { vi } from "vitest";

/**
 * Lightweight Drizzle mock for unit-testing DB-backed services without a real
 * D1 binding (none is available in the Vitest node environment).
 *
 * The mock ignores SQL semantics: every `select()` chain resolves to the next
 * array queued via `queueSelect()`, in await order. Mutations (`insert`,
 * `update`, `delete`) resolve to `undefined` and record their table + payload
 * so tests can assert what was written. All builder methods (`from`, `where`,
 * `limit`, joins, etc.) are chainable no-ops, and every builder is thenable so
 * `await db.select()...` and `db.select()....then()` both work.
 */
export type Row = Record<string, unknown>;

export function createDbMock() {
	const selectQueue: Row[][] = [];
	const inserts: { table: unknown; values: unknown }[] = [];
	const updates: { table: unknown; set: unknown }[] = [];
	const deletes: { table: unknown }[] = [];

	const chainMethods = [
		"from",
		"where",
		"limit",
		"offset",
		"orderBy",
		"groupBy",
		"having",
		"leftJoin",
		"innerJoin",
		"rightJoin",
		"fullJoin",
		"returning",
		"onConflictDoNothing",
		"onConflictDoUpdate",
		"all",
		"get",
		"run",
	];

	// A builder whose terminal value is configurable. `.get()` resolves to the
	// first row of the next queued select; `.returning()` resolves to the next
	// queued select array; a bare await resolves to `base()`.
	function makeBuilder(base: () => unknown) {
		let resolve = base;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const b: any = {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			then: (onF: any, onR: any) => Promise.resolve(resolve()).then(onF, onR),
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			catch: (onR: any) => Promise.resolve(resolve()).catch(onR),
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			finally: (onF: any) => Promise.resolve(resolve()).finally(onF),
		};
		for (const m of chainMethods) b[m] = vi.fn(() => b);
		b.get = vi.fn(() => {
			resolve = () => (selectQueue.shift() ?? [])[0];
			return b;
		});
		b.returning = vi.fn(() => {
			resolve = () => selectQueue.shift() ?? [];
			return b;
		});
		return b;
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const db: any = {
		batch: vi.fn(async () => undefined),
		select: vi.fn(() => makeBuilder(() => selectQueue.shift() ?? [])),
		insert: vi.fn((table: unknown) => {
			const b = makeBuilder(() => undefined);
			b.values = vi.fn((values: unknown) => {
				inserts.push({ table, values });
				return b;
			});
			return b;
		}),
		update: vi.fn((table: unknown) => {
			const b = makeBuilder(() => undefined);
			b.set = vi.fn((set: unknown) => {
				updates.push({ table, set });
				return b;
			});
			return b;
		}),
		delete: vi.fn((table: unknown) => {
			deletes.push({ table });
			return makeBuilder(() => undefined);
		}),
	};

	return {
		db,
		inserts,
		updates,
		deletes,
		/** Queue the rows the next awaited select() chain should resolve to. */
		queueSelect(rows: Row[]) {
			selectQueue.push(rows);
			return this;
		},
	};
}

export type DbMock = ReturnType<typeof createDbMock>;
