import { describe, expect, it } from "vitest";
import {
	addDomainSchema,
	createAliasSchema,
	firstRunRegisterSchema,
	loginSchema,
	mailboxSchema,
	registerSchema,
	routingRuleSchema,
	routingRuleUpdateSchema,
	sendEmailSchema,
	updateProfileSchema,
	updateAliasGroupSchema,
	webhookSchema,
} from "@/lib/validators";

describe("createAliasSchema", () => {
	it("normalizes a mailbox alias and rejects external/provider fields", () => {
		expect(createAliasSchema.parse({
			kind: "mailbox",
			domainId: "dom_1",
			localPart: " Support ",
			targetMailboxId: "mbx_1",
		})).toEqual({
			kind: "mailbox",
			domainId: "dom_1",
			localPart: "support",
			targetMailboxId: "mbx_1",
		});
		expect(createAliasSchema.safeParse({
			kind: "mailbox",
			domainId: "dom_1",
			localPart: "support",
			forwardTo: "outside@example.net",
		}).success).toBe(false);
	});

	it("requires 2–50 unique mailbox IDs for a group", () => {
		const valid = {
			kind: "group",
			domainId: "dom_1",
			localPart: "Team",
			mailboxIds: ["mbx_1", "mbx_2"],
		};
		expect(createAliasSchema.parse(valid)).toMatchObject({ localPart: "team" });
		expect(createAliasSchema.safeParse({ ...valid, mailboxIds: ["mbx_1"] }).success).toBe(false);
		expect(createAliasSchema.safeParse({ ...valid, mailboxIds: ["mbx_1", "mbx_1"] }).success).toBe(false);
		expect(createAliasSchema.safeParse({
			...valid,
			mailboxIds: Array.from({ length: 51 }, (_, index) => `mbx_${index}`),
		}).success).toBe(false);
	});

	it("rejects duplicate mailbox IDs in a group update", () => {
		expect(updateAliasGroupSchema.safeParse({
			mailboxIds: ["mbx_1", "mbx_1"],
		}).success).toBe(false);
		expect(updateAliasGroupSchema.safeParse({
			mailboxIds: ["mbx_1", "mbx_2"],
		}).success).toBe(true);
	});
});

describe("registerSchema", () => {
	it("accepts a valid registration", () => {
		const result = registerSchema.safeParse({
			email: "user@example.com",
			password: "supersecret",
			name: "Ada",
		});
		expect(result.success).toBe(true);
	});

	it("rejects an invalid email and short password", () => {
		expect(registerSchema.safeParse({ email: "nope", password: "x", name: "Ada" }).success).toBe(
			false,
		);
	});
});

describe("loginSchema", () => {
	it("requires a non-empty password", () => {
		expect(loginSchema.safeParse({ email: "u@e.com", password: "" }).success).toBe(false);
		expect(loginSchema.safeParse({ email: "u@e.com", password: "p" }).success).toBe(true);
	});
});

describe("firstRunRegisterSchema", () => {
	it("rejects usernames with illegal characters", () => {
		expect(
			firstRunRegisterSchema.safeParse({
				domain: "example.com",
				username: "bad name",
				password: "supersecret",
				resetEmail: "u@e.com",
			}).success,
		).toBe(false);
	});

	it("accepts a clean username", () => {
		expect(
			firstRunRegisterSchema.safeParse({
				domain: "example.com",
				username: "ada.lovelace",
				password: "supersecret",
				resetEmail: "u@e.com",
			}).success,
		).toBe(true);
	});
});

describe("sendEmailSchema", () => {
	it("enforces subject length bounds", () => {
		const base = { from: "a@b.co", to: "c@d.co" };
		expect(sendEmailSchema.safeParse({ ...base, subject: "" }).success).toBe(false);
		expect(sendEmailSchema.safeParse({ ...base, subject: "x".repeat(501) }).success).toBe(false);
		expect(sendEmailSchema.safeParse({ ...base, subject: "Hi" }).success).toBe(true);
	});
});

describe("addDomainSchema", () => {
	it("accepts optional routing/sending flags", () => {
		expect(
			addDomainSchema.safeParse({ hostname: "mail.example.com", enableRouting: true }).success,
		).toBe(true);
		expect(addDomainSchema.safeParse({ hostname: "ab" }).success).toBe(false);
	});
});

describe("mailboxSchema", () => {
	it("requires domainId and localPart", () => {
		expect(mailboxSchema.safeParse({ domainId: "d1", localPart: "support" }).success).toBe(true);
		expect(mailboxSchema.safeParse({ domainId: "", localPart: "support" }).success).toBe(false);
	});
});

describe("updateProfileSchema", () => {
	it("normalises an empty reset email to null", () => {
		const result = updateProfileSchema.safeParse({ name: "Ada", resetEmail: "  " });
		expect(result.success).toBe(true);
		if (result.success) expect(result.data.resetEmail).toBeNull();
	});

	it("trims and keeps a valid reset email", () => {
		const result = updateProfileSchema.safeParse({ name: "Ada", resetEmail: " a@b.co " });
		expect(result.success).toBe(true);
		if (result.success) expect(result.data.resetEmail).toBe("a@b.co");
	});

	it("rejects a non-string reset email without trimming it", () => {
		const result = updateProfileSchema.safeParse({ name: "Ada", resetEmail: 123 });
		expect(result.success).toBe(false);
	});
});

describe("routingRuleSchema", () => {
	it("defaults priority to 0 and validates the action enum", () => {
		const result = routingRuleSchema.safeParse({
			domainId: "d1",
			pattern: "*@example.com",
			action: "store",
			mailboxId: "mb1",
		});
		expect(result.success).toBe(true);
		if (result.success) expect(result.data.priority).toBe(0);
		expect(
			routingRuleSchema.safeParse({ domainId: "d1", pattern: "*", action: "explode" }).success,
		).toBe(false);
	});

	it("requires action-specific targets", () => {
		expect(routingRuleSchema.safeParse({ domainId: "d1", pattern: "*", action: "store" }).success).toBe(false);
		expect(routingRuleSchema.safeParse({ domainId: "d1", pattern: "*", action: "forward" }).success).toBe(false);
		expect(routingRuleSchema.safeParse({ domainId: "d1", pattern: "*", action: "forward", forwardTo: "x@y.test" }).success).toBe(true);
		expect(routingRuleSchema.safeParse({ domainId: "d1", pattern: "*", action: "reject" }).success).toBe(true);
	});

	it("keeps routing updates partial without injecting defaults", () => {
		expect(routingRuleUpdateSchema.parse({ pattern: "admin" })).toEqual({ pattern: "admin" });
		expect(routingRuleUpdateSchema.parse({ ignored: true })).toEqual({});
	});

	it("accepts a bounded internal reply source id", () => {
		const base = { from: "a@b.co", to: "c@d.co", subject: "Re: Hi" };
		expect(sendEmailSchema.safeParse({
			...base,
			replyToMessageId: "msg_parent",
		}).success).toBe(true);
		expect(sendEmailSchema.safeParse({
			...base,
			replyToMessageId: "x".repeat(101),
		}).success).toBe(false);
	});
});

describe("webhookSchema", () => {
	it("requires a valid url and at least one event", () => {
		expect(webhookSchema.safeParse({ url: "https://x.co/hook", events: ["mail"] }).success).toBe(
			true,
		);
		expect(webhookSchema.safeParse({ url: "not-a-url", events: ["mail"] }).success).toBe(false);
		expect(webhookSchema.safeParse({ url: "https://x.co/hook", events: [] }).success).toBe(false);
	});
});
