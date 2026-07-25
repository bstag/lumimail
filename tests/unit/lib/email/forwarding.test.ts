import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock, type DbMock } from "../../helpers/db";

import {
	authorizeForwardDestination,
	forwardInbound,
	selectForwardTargets,
	shouldRejectUndeliverable,
} from "@/lib/email/forwarding";
import type { RoutingDecision } from "@/lib/email/routing";

let mock: DbMock;

beforeEach(() => {
	vi.clearAllMocks();
	mock = createDbMock();
});

const verified = {
	id: "fwd_1",
	address: "ops@example.net",
	verifiedAt: new Date("2026-07-24T00:00:00Z"),
};

describe("authorizeForwardDestination", () => {
	it("allows an owned, verified destination outside every managed domain", async () => {
		mock.queueSelect([]); // managed-domain lookup: not managed
		mock.queueSelect([verified]);

		await expect(authorizeForwardDestination(mock.db, "org_1", "ops@example.net")).resolves.toEqual({
			allowed: true,
			address: "ops@example.net",
		});
	});

	it("normalizes the address before checking ownership", async () => {
		mock.queueSelect([]);
		mock.queueSelect([verified]);

		await expect(authorizeForwardDestination(mock.db, "org_1", "  OPS@Example.NET ")).resolves.toEqual({
			allowed: true,
			address: "ops@example.net",
		});
	});

	it("refuses a destination inside a Lumimail-managed domain", async () => {
		mock.queueSelect([{ id: "dom_1" }]); // managed domain matched

		await expect(authorizeForwardDestination(mock.db, "org_1", "someone@managed.com")).resolves.toEqual({
			allowed: false,
			reason: "managed_domain",
		});
	});

	it("refuses an address this organization never registered", async () => {
		mock.queueSelect([]);
		mock.queueSelect([]); // no ownership row

		await expect(authorizeForwardDestination(mock.db, "org_1", "other@example.net")).resolves.toEqual({
			allowed: false,
			reason: "not_owned",
		});
	});

	it("refuses an owned destination that Cloudflare has not verified", async () => {
		mock.queueSelect([]);
		mock.queueSelect([{ id: "fwd_2", address: "pending@example.net", verifiedAt: null }]);

		await expect(authorizeForwardDestination(mock.db, "org_1", "pending@example.net")).resolves.toEqual({
			allowed: false,
			reason: "not_verified",
		});
	});

	it("refuses an unparseable address without querying ownership", async () => {
		await expect(authorizeForwardDestination(mock.db, "org_1", "not-an-address")).resolves.toEqual({
			allowed: false,
			reason: "invalid_address",
		});
	});

	it("refuses when the decision carries no owning organization", async () => {
		await expect(authorizeForwardDestination(mock.db, null, "ops@example.net")).resolves.toEqual({
			allowed: false,
			reason: "not_owned",
		});
	});
});

describe("selectForwardTargets", () => {
	function forwardDecision(address: string, organizationId: string | null): RoutingDecision {
		return { action: "forward", forwardTo: address, organizationId };
	}

	it("returns only authorized destinations and drops the rest", async () => {
		mock.queueSelect([]);
		mock.queueSelect([verified]);
		mock.queueSelect([]);
		mock.queueSelect([]); // second destination is unowned

		const result = await selectForwardTargets(mock.db, [
			forwardDecision("ops@example.net", "org_1"),
			forwardDecision("stranger@example.net", "org_1"),
		]);

		expect(result.allowed).toEqual(["ops@example.net"]);
		expect(result.refused).toEqual([
			{ address: "stranger@example.net", reason: "not_owned" },
		]);
	});

	it("refuses a forward decision that carries no owning organization", async () => {
		const result = await selectForwardTargets(mock.db, [
			{ action: "forward", forwardTo: "orphan@example.net" },
		]);

		expect(result.allowed).toEqual([]);
		expect(result.refused).toEqual([{ address: "orphan@example.net", reason: "not_owned" }]);
	});

	it("ignores non-forward decisions", async () => {
		const result = await selectForwardTargets(mock.db, [
			{ action: "store" },
			{ action: "reject" },
		]);

		expect(result.allowed).toEqual([]);
		expect(result.refused).toEqual([]);
	});

	it("deduplicates the same destination reached through several rules", async () => {
		mock.queueSelect([]);
		mock.queueSelect([verified]);

		const result = await selectForwardTargets(mock.db, [
			forwardDecision("ops@example.net", "org_1"),
			forwardDecision("OPS@example.net", "org_1"),
		]);

		expect(result.allowed).toEqual(["ops@example.net"]);
	});
});

describe("forwardInbound", () => {
	const decision: RoutingDecision = {
		action: "forward",
		forwardTo: "ops@example.net",
		organizationId: "org_1",
	};

	it("forwards to each authorized destination", async () => {
		mock.queueSelect([]);
		mock.queueSelect([verified]);
		const forward = vi.fn().mockResolvedValue(undefined);

		const result = await forwardInbound(mock.db, { forward }, [decision]);

		expect(forward).toHaveBeenCalledWith("ops@example.net");
		expect(result.forwarded).toEqual(["ops@example.net"]);
		expect(result.failed).toEqual([]);
	});

	it("records a forwarding failure without throwing", async () => {
		mock.queueSelect([]);
		mock.queueSelect([verified]);
		const forward = vi.fn().mockRejectedValue(new Error("unverified"));

		const result = await forwardInbound(mock.db, { forward }, [decision]);

		expect(result.forwarded).toEqual([]);
		expect(result.failed).toEqual(["ops@example.net"]);
	});

	it("attempts every destination even when an earlier one fails", async () => {
		mock.queueSelect([]);
		mock.queueSelect([verified]);
		mock.queueSelect([]);
		mock.queueSelect([{ id: "fwd_3", address: "second@example.net", verifiedAt: new Date() }]);
		const forward = vi
			.fn()
			.mockRejectedValueOnce(new Error("boom"))
			.mockResolvedValueOnce(undefined);

		const result = await forwardInbound(mock.db, { forward }, [
			decision,
			{ action: "forward", forwardTo: "second@example.net", organizationId: "org_1" },
		]);

		expect(forward).toHaveBeenCalledTimes(2);
		expect(result.forwarded).toEqual(["second@example.net"]);
		expect(result.failed).toEqual(["ops@example.net"]);
	});
});

describe("shouldRejectUndeliverable", () => {
	const empty = { forwarded: [], refused: [], failed: [] };
	const storeDecision: RoutingDecision = {
		action: "store",
		mailbox: { mailboxId: "mb_1" } as RoutingDecision["mailbox"],
	};
	const forwardDecision: RoutingDecision = {
		action: "forward",
		forwardTo: "ops@example.net",
		organizationId: "org_1",
	};

	it("rejects when forwarding was the only delivery and nothing was forwarded", () => {
		expect(shouldRejectUndeliverable([forwardDecision], empty)).toBe(true);
	});

	it("accepts when a mailbox is still storing the message", () => {
		expect(shouldRejectUndeliverable([forwardDecision, storeDecision], empty)).toBe(false);
	});

	it("accepts when at least one forward succeeded", () => {
		expect(
			shouldRejectUndeliverable([forwardDecision], { ...empty, forwarded: ["ops@example.net"] }),
		).toBe(false);
	});

	it("does not reject ordinary mail that never requested forwarding", () => {
		expect(shouldRejectUndeliverable([storeDecision], empty)).toBe(false);
		expect(shouldRejectUndeliverable([], empty)).toBe(false);
	});
});
