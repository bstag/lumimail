import { describe, expect, it } from "vitest";
import { BULK_ID_CHUNK, chunkIds } from "@/components/messages/other-digest-utils";

describe("chunkIds (F99)", () => {
	it("splits IDs into D1-safe batches", () => {
		const ids = Array.from({ length: 170 }, (_, index) => `m${index}`);
		expect(chunkIds(ids).map((chunk) => chunk.length)).toEqual([80, 80, 10]);
		expect(chunkIds([])).toEqual([]);
		expect(BULK_ID_CHUNK).toBeLessThan(100);
	});
});
