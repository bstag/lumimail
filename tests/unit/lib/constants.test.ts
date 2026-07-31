import { describe, expect, it } from "vitest";
import {
	DEFAULT_LABEL_COLOR,
	DOMAIN_HOSTNAME_REGEX,
	MAILBOX_ROLES,
	MAX_STORED_ERROR_LENGTH,
	MESSAGE_STATUSES,
	ORG_INVITE_ROLES,
	RETRY_DELAY_SECONDS,
	ROUTING_ACTIONS,
	SENDER_ROLES,
	WEBHOOK_DELIVERY_STATUSES,
} from "@/lib/constants";
import { schema } from "@/db/schema";
import { mailboxMembershipSchema, routingRuleSchema } from "@/lib/validators";

describe("shared enums and limits", () => {
	it("keeps sender roles a strict subset of mailbox roles", () => {
		expect(MAILBOX_ROLES).toEqual(["viewer", "responder", "manager"]);
		expect(SENDER_ROLES).toEqual(["responder", "manager"]);
		for (const role of SENDER_ROLES) expect(MAILBOX_ROLES).toContain(role);
	});

	it("exposes the org invite roles and routing actions", () => {
		expect(ORG_INVITE_ROLES).toEqual(["admin", "member"]);
		expect(ROUTING_ACTIONS).toEqual(["store", "forward", "reject"]);
	});

	it("keeps the default label color a six-digit hex value", () => {
		expect(DEFAULT_LABEL_COLOR).toMatch(/^#[0-9a-f]{6}$/);
	});

	it("accepts registrable hostnames and rejects bare or malformed ones", () => {
		expect(DOMAIN_HOSTNAME_REGEX.test("example.com")).toBe(true);
		expect(DOMAIN_HOSTNAME_REGEX.test("mail.example.co.uk")).toBe(true);
		expect(DOMAIN_HOSTNAME_REGEX.test("localhost")).toBe(false);
		expect(DOMAIN_HOSTNAME_REGEX.test("-bad.example.com")).toBe(false);
		expect(DOMAIN_HOSTNAME_REGEX.test("example.c0m")).toBe(false);
	});

	it("pins the queue retry delay and stored-error cap", () => {
		expect(RETRY_DELAY_SECONDS).toBe(30);
		expect(MAX_STORED_ERROR_LENGTH).toBe(500);
	});
});

describe("schema consumption", () => {
	it("lists every status the application writes to messages.status", () => {
		expect(MESSAGE_STATUSES).toEqual([
			"received",
			"queued",
			"sent",
			"failed",
			"draft",
			"trash",
			"spam",
			"archived",
		]);
		expect(schema.messages.status.enumValues).toEqual(MESSAGE_STATUSES);
	});

	it("lists every status webhook delivery writes", () => {
		expect(WEBHOOK_DELIVERY_STATUSES).toEqual(["pending", "delivered", "failed"]);
		expect(schema.webhookDeliveries.status.enumValues).toEqual([...WEBHOOK_DELIVERY_STATUSES]);
	});

	it("drives the role and action column enums from the shared constants", () => {
		expect(schema.mailboxMemberships.role.enumValues).toEqual([...MAILBOX_ROLES]);
		expect(schema.orgInvites.role.enumValues).toEqual([...ORG_INVITE_ROLES]);
		expect(schema.routingRules.action.enumValues).toEqual([...ROUTING_ACTIONS]);
		expect(schema.labels.color.default).toBe(DEFAULT_LABEL_COLOR);
	});
});

describe("validator consumption", () => {
	it("drives the Zod role and action enums from the shared constants", () => {
		expect(mailboxMembershipSchema.shape.role.options).toEqual([...MAILBOX_ROLES]);
		for (const action of ROUTING_ACTIONS) {
			expect(routingRuleSchema.safeParse({
				domainId: "d1",
				pattern: "*",
				action,
				mailboxId: "mb1",
				forwardTo: "x@y.test",
			}).success).toBe(true);
		}
	});
});
