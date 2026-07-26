import { describe, expect, it } from "vitest";
import {
	SIDEBAR_STORAGE_KEY,
	SIDEBAR_WIDTH,
	readSidebarCollapsed,
	sidebarGridColumns,
	writeSidebarCollapsed,
} from "@/components/nav-sidebar-utils";

function memoryStorage(initial: Record<string, string> = {}) {
	const data = new Map(Object.entries(initial));
	return {
		getItem: (key: string) => data.get(key) ?? null,
		setItem: (key: string, value: string) => {
			data.set(key, value);
		},
		read: (key: string) => data.get(key) ?? null,
	};
}

describe("readSidebarCollapsed", () => {
	it("reports collapsed only for the explicit stored flag", () => {
		expect(readSidebarCollapsed(memoryStorage({ [SIDEBAR_STORAGE_KEY]: "1" }))).toBe(true);
		expect(readSidebarCollapsed(memoryStorage({ [SIDEBAR_STORAGE_KEY]: "0" }))).toBe(false);
	});

	it("defaults to expanded when nothing has been stored", () => {
		expect(readSidebarCollapsed(memoryStorage())).toBe(false);
	});

	it("defaults to expanded for a value an older build might have written", () => {
		expect(readSidebarCollapsed(memoryStorage({ [SIDEBAR_STORAGE_KEY]: "true" }))).toBe(false);
	});

	it("defaults to expanded when there is no storage at all", () => {
		expect(readSidebarCollapsed(null)).toBe(false);
		expect(readSidebarCollapsed(undefined)).toBe(false);
	});

	it("defaults to expanded when storage throws", () => {
		// Safari's private mode raises on access. Refusing to render a nav over a
		// missing preference would be a much worse failure than opening expanded.
		const hostile = {
			getItem() {
				throw new Error("SecurityError");
			},
		};
		expect(readSidebarCollapsed(hostile)).toBe(false);
	});
});

describe("writeSidebarCollapsed", () => {
	it("stores both states explicitly", () => {
		const storage = memoryStorage();
		writeSidebarCollapsed(storage, true);
		expect(storage.read(SIDEBAR_STORAGE_KEY)).toBe("1");
		writeSidebarCollapsed(storage, false);
		expect(storage.read(SIDEBAR_STORAGE_KEY)).toBe("0");
	});

	it("round-trips through the reader", () => {
		const storage = memoryStorage();
		writeSidebarCollapsed(storage, true);
		expect(readSidebarCollapsed(storage)).toBe(true);
	});

	it("is a no-op without storage", () => {
		expect(() => writeSidebarCollapsed(null, true)).not.toThrow();
		expect(() => writeSidebarCollapsed(undefined, true)).not.toThrow();
	});

	it("swallows a storage that refuses to write", () => {
		const hostile = {
			setItem() {
				throw new Error("QuotaExceededError");
			},
		};
		expect(() => writeSidebarCollapsed(hostile, true)).not.toThrow();
	});
});

describe("sidebarGridColumns", () => {
	it("gives the rail its width when collapsed", () => {
		expect(sidebarGridColumns(true)).toBe(`${SIDEBAR_WIDTH.collapsed}px 1fr`);
	});

	it("gives the full sidebar its width when expanded", () => {
		expect(sidebarGridColumns(false)).toBe(`${SIDEBAR_WIDTH.expanded}px 1fr`);
	});

	it("returns a wider first column expanded than collapsed", () => {
		expect(SIDEBAR_WIDTH.expanded).toBeGreaterThan(SIDEBAR_WIDTH.collapsed);
	});
});
