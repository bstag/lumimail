import { describe, expect, it } from "vitest";
import { summariseDns, type DnsStatusSummary } from "@/lib/dns-status";

function makeRecord(type: string): { type: string } {
	return { type };
}

describe("summariseDns", () => {
	it("reports routing as configured when records present and none missing", () => {
		const result = summariseDns(
			[makeRecord("MX"), makeRecord("TXT")],
			[],
			{ enabled: false, records: [] },
		);
		expect(result.routing.configured).toBe(true);
		expect(result.routing.missing).toEqual([]);
	});

	it("reports routing as not configured when all records missing", () => {
		const result = summariseDns([], [makeRecord("MX")], { enabled: false, records: [] });
		expect(result.routing.configured).toBe(false);
		expect(result.routing.missing).toContain("MX");
	});

	it("reports routing as not configured when no routing records at all", () => {
		const result = summariseDns([], [], { enabled: false, records: [] });
		expect(result.routing.configured).toBe(false);
	});

	it("reports sending as configured from provider enablement and lists record types", () => {
		const result = summariseDns([], [], {
			enabled: true,
			records: [makeRecord("TXT"), makeRecord("MX")],
		});
		expect(result.sending.configured).toBe(true);
		expect(result.sending.records).toContain("TXT");
		expect(result.sending.records).toContain("MX");
	});

	it("does not fabricate readiness from required records alone", () => {
		const result = summariseDns([], [], { enabled: false, records: [makeRecord("TXT")] });
		expect(result.sending.configured).toBe(false);
		expect(result.sending.records).toEqual(["TXT"]);
	});

	it("deduplicates record types in missing and records lists", () => {
		const result = summariseDns(
			[makeRecord("MX")],
			[makeRecord("MX"), makeRecord("MX")],
			{ enabled: true, records: [makeRecord("TXT"), makeRecord("TXT")] },
		);
		expect(result.routing.missing).toEqual(["MX"]);
		expect(result.sending.records).toEqual(["TXT"]);
	});

	it("filters out records with null types", () => {
		const result = summariseDns(
			[makeRecord("MX"), { type: null } as never],
			[],
			{ enabled: false, records: [] },
		);
		expect(result.routing.missing).toEqual([]);
	});
});
