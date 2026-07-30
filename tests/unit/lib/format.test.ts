import { describe, expect, it } from "vitest";
import { formatBytes } from "@/lib/format";

describe("formatBytes", () => {
	it("prints plain bytes below one KB", () => {
		expect(formatBytes(0)).toBe("0 B");
		expect(formatBytes(1023)).toBe("1023 B");
	});

	it("prints one decimal of KB from 1024 bytes", () => {
		expect(formatBytes(1024)).toBe("1.0 KB");
		expect(formatBytes(1536)).toBe("1.5 KB");
		expect(formatBytes(1024 * 1024 - 1)).toBe("1024.0 KB");
	});

	it("prints one decimal of MB from 1 MiB", () => {
		expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
		expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
	});
});
