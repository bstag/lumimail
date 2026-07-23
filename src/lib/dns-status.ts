import type { CfDnsRecord } from "@/lib/cloudflare-api";

export type DnsStatusSummary = {
	routing: {
		configured: boolean;
		missing: string[];
	};
	sending: {
		configured: boolean;
		records: string[];
	};
};

export function summariseDns(
	routingRecords: CfDnsRecord[],
	routingMissing: CfDnsRecord[],
	sending: { enabled: boolean; records: CfDnsRecord[] },
): DnsStatusSummary {
	const recordTypes = (
		type: "routing-missing" | "sending",
	) => {
		const list = type === "routing-missing" ? routingMissing : sending.records;
		return [...new Set(list.map((r) => r.type).filter(Boolean))] as string[];
	};

	return {
		routing: {
			configured: routingMissing.length === 0 && routingRecords.length > 0,
			missing: recordTypes("routing-missing"),
		},
		sending: {
			configured: sending.enabled,
			records: recordTypes("sending"),
		},
	};
}
