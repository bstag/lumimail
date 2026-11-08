import { describe, expect, it } from "vitest";
import { categorizationConfigSchema } from "@/lib/validators";
import {
	DEFAULT_CONFIG,
	evaluateRules,
	interpretAnswers,
	buildJevRequest,
	configuredTags,
	type CategoryQuestion,
} from "@/lib/categorization/engine";

describe("personal categorization", () => {
	it("validates questions and rejects unsafe or ambiguous configurations", () => {
		expect(categorizationConfigSchema.safeParse(DEFAULT_CONFIG).success).toBe(
			true,
		);
		expect(
			categorizationConfigSchema.safeParse({
				...DEFAULT_CONFIG,
				rules: [
					{
						id: "r",
						name: "All",
						enabled: true,
						sender: "",
						senderMode: "exact",
						subject: "",
						words: "",
						tag: "All",
					},
				],
			}).success,
		).toBe(false);
		expect(
			categorizationConfigSchema.safeParse({
				...DEFAULT_CONFIG,
				questions: [DEFAULT_CONFIG.questions[0], DEFAULT_CONFIG.questions[0]],
			}).success,
		).toBe(false);
		expect(
			categorizationConfigSchema.safeParse({
				...DEFAULT_CONFIG,
				questions: [{ ...DEFAULT_CONFIG.questions[0], threshold: 0.1 }],
			}).success,
		).toBe(false);
	});
	it("matches normalized exact addresses and domains, with AND conditions", () => {
		const rules = [
			{
				id: "r",
				name: "Statements",
				enabled: true,
				senderMode: "domain" as const,
				sender: "BANK.EXAMPLE",
				subject: "Statement",
				words: "monthly",
				tag: "Banking",
			},
		];
		expect(
			evaluateRules(rules, {
				fromAddr: '"Bank" <alerts@bank.example>',
				subject: "Your STATEMENT",
				text: "Monthly balance",
			}),
		).toEqual([{ tag: "Banking", reason: "Statements" }]);
		expect(
			evaluateRules(rules, {
				fromAddr: "alerts@bank.example.evil.test",
				subject: "Statement",
				text: "monthly",
			}),
		).toEqual([]);
		expect(
			evaluateRules(rules, {
				fromAddr: "alerts@bank.example",
				subject: null,
				text: null,
			}),
		).toEqual([]);
	});
	it("accepts a category only above its configured probability threshold", () => {
		const config = {
			...DEFAULT_CONFIG,
			questions: [DEFAULT_CONFIG.questions[0]],
		};
		const answer = {
			category: {
				type: "choice",
				choice: "Newsletters",
				probabilities: {
					Personal: 0.01,
					Promotions: 0.01,
					Newsletters: 0.92,
					Updates: 0.01,
					Banking: 0.01,
					Receipts: 0.01,
					Other: 0.03,
				},
				confidence: 0.9,
			},
		};
		expect(interpretAnswers(config, answer).tags).toEqual([
			{ tag: "Newsletters", reason: "Email type" },
		]);
		expect(() =>
			interpretAnswers(config, { ...answer, unexpected: {} }),
		).toThrow();
		expect(() =>
			interpretAnswers(config, {
				category: { ...answer.category, choice: "Invented" },
			}),
		).toThrow();
	});
	it("sends bounded plain text and never attachments or HTML", () => {
		const request = buildJevRequest(DEFAULT_CONFIG, {
			fromAddr: "a@example.com",
			toAddr: "b@example.com",
			subject: "Hi",
			text: "x".repeat(9000),
		});
		expect(request.state.email.body).toHaveLength(8000);
		expect(request.questions.category.type).toBe("choice");
		expect(request.questions.urgency.type).toBe("score");
	});
	it("validates exact/domain conditions and unique option/rule names", () => {
		const rule = {
			id: "r",
			name: "Source",
			enabled: true,
			senderMode: "exact" as const,
			sender: "a@example.com",
			subject: "",
			words: "",
			tag: "Source",
		};
		for (const sender of ["a@example.com", "invalid"])
			expect(
				categorizationConfigSchema.safeParse({
					...DEFAULT_CONFIG,
					rules: [{ ...rule, sender }],
				}).success,
			).toBe(sender.includes("@"));
		for (const sender of ["example.com", "bad domain"])
			expect(
				categorizationConfigSchema.safeParse({
					...DEFAULT_CONFIG,
					rules: [{ ...rule, senderMode: "domain", sender }],
				}).success,
			).toBe(sender === "example.com");
		expect(
			categorizationConfigSchema.safeParse({
				...DEFAULT_CONFIG,
				rules: [rule, rule],
			}).success,
		).toBe(false);
		const q = DEFAULT_CONFIG.questions[0];
		if (q.type !== "choice") throw new Error("Expected choice");
		expect(
			categorizationConfigSchema.safeParse({
				...DEFAULT_CONFIG,
				questions: [{ ...q, options: [q.options[0], q.options[0]] }],
			}).success,
		).toBe(false);
		expect(
			evaluateRules([{ ...rule, senderMode: "exact" }], {
				fromAddr: "a@example.com",
				subject: null,
				text: null,
			}),
		).toHaveLength(1);
		expect(
			evaluateRules([{ ...rule, enabled: false }], {
				fromAddr: "a@example.com",
				subject: null,
				text: null,
			}),
		).toEqual([]);
		expect(
			evaluateRules([{ ...rule, sender: "", subject: "", words: "monthly" }], {
				fromAddr: "a@example.com",
				subject: null,
				text: null,
			}),
		).toEqual([]);
		expect(
			buildJevRequest(
				{
					...DEFAULT_CONFIG,
					questions: DEFAULT_CONFIG.questions.map((q) => ({
						...q,
						enabled: false,
					})),
				},
				{ fromAddr: "a", subject: null, text: null },
			).questions,
		).toEqual({});
		expect(configuredTags({ ...DEFAULT_CONFIG, rules: [rule] })).toContain(
			"Source",
		);
		expect(
			configuredTags({
				...DEFAULT_CONFIG,
				questions: [
					{ ...DEFAULT_CONFIG.questions[1], tag: null } as CategoryQuestion,
				],
			}),
		).toEqual([]);
	});
	it("retains uncertainty and treats Other and confident no as no tag", () => {
		const q = {
			...DEFAULT_CONFIG.questions[0],
			type: "choice" as const,
			options: [
				{ value: "Yes", description: "Yes", tag: "Yes" },
				{ value: "Other", description: "Other", tag: null },
			],
		};
		const config = { ...DEFAULT_CONFIG, questions: [q] };
		const answer = (choice: string, probabilities: Record<string, number>) => ({
			category: { type: "choice", choice, probabilities, confidence: 0.9 },
		});
		expect(
			interpretAnswers(config, answer("Yes", { Yes: 0.7, Other: 0.3 }))
				.uncertain,
		).toEqual(["category"]);
		expect(
			interpretAnswers(config, answer("Other", { Yes: 0.01, Other: 0.99 }))
				.tags,
		).toEqual([]);
		for (const probabilities of [
			{ Yes: 1 },
			{ Yes: 0.5, Invalid: 0.5 },
			{ Yes: 0.9, Other: 0.9 },
		] as Record<string, number>[])
			expect(() =>
				interpretAnswers(config, answer("Yes", probabilities)),
			).toThrow("probabilities");
		expect(() =>
			interpretAnswers(config, answer("Other", { Yes: 0.9, Other: 0.1 })),
		).toThrow("invalid choice");
		expect(() => interpretAnswers(config, {})).toThrow("keys");
		expect(() =>
			interpretAnswers(config, { wrong: { type: "noul", noul: 1 } }),
		).toThrow();
		const noul = DEFAULT_CONFIG.questions[1];
		for (const [p, tagCount, uncertainCount] of [
			[0.99, 1, 0],
			[0.5, 0, 1],
			[0, 0, 0],
			[0.1, 0, 1],
		]) {
			const result = interpretAnswers(
				{ ...DEFAULT_CONFIG, questions: [noul] },
				{ needs_reply: { type: "noul", noul: p } },
			);
			expect(result.tags).toHaveLength(tagCount);
			expect(result.uncertain).toHaveLength(uncertainCount);
		}
		expect(
			interpretAnswers(
				{
					...DEFAULT_CONFIG,
					questions: [{ ...noul, tag: null } as CategoryQuestion],
				},
				{ needs_reply: { type: "noul", noul: 1 } },
			).tags,
		).toEqual([]);
	});
	it("checks score distributions, range, and the full configured legend", () => {
		const q = DEFAULT_CONFIG.questions[2];
		if (q.type !== "score") throw new Error("Expected score");
		const config = { ...DEFAULT_CONFIG, questions: [q] };
		const answer = {
			type: "score",
			score: 1,
			confidence: 0.9,
			probabilities: { "0": 0, "1": 1, "2": 0, "3": 0 },
			legend: Object.fromEntries(
				q.levels.map((level, i) => [String(i), level]),
			),
		};
		expect(interpretAnswers(config, { urgency: answer }).uncertain).toEqual([]);
		expect(
			interpretAnswers(config, {
				urgency: {
					...answer,
					probabilities: { "0": 0.25, "1": 0.25, "2": 0.25, "3": 0.25 },
				},
			}).uncertain,
		).toEqual(["urgency"]);
		for (const invalid of [
			{ score: -1 },
			{ score: 4 },
			{ legend: {} },
			{ legend: { ...answer.legend, "0": "Wrong" } },
		])
			expect(() =>
				interpretAnswers(config, { urgency: { ...answer, ...invalid } }),
			).toThrow("score");
	});
});
