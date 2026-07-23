/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { normalizeSubmission } = require("../src/smtp-server");

test("submission binds sender and mailbox and uses one envelope recipient string", () => {
	const result = normalizeSubmission(
		{
			envelope: {
				mailFrom: { address: "support@example.com" },
				rcptTo: [{ address: "person@example.net" }],
			},
		},
		{
			from: { value: [{ address: "support@example.com" }] },
			to: { value: [{ address: "person@example.net" }] },
			subject: "Hello",
			text: "Body",
			html: false,
		},
		{
			mailbox: { id: "mb1", address: "support@example.com" },
		},
	);

	assert.deepEqual(result, {
		to: "person@example.net",
		subject: "Hello",
		text: "Body",
		html: undefined,
	});
});

test("submission rejects sender mismatch and multiple recipients", () => {
	const creds = { mailbox: { id: "mb1", address: "support@example.com" } };
	assert.throws(
		() => normalizeSubmission(
			{ envelope: { mailFrom: { address: "other@example.com" }, rcptTo: [{ address: "one@example.net" }] } },
			{ from: { value: [{ address: "other@example.com" }] } },
			creds,
		),
		/not authorized/i,
	);
	assert.throws(
		() => normalizeSubmission(
			{
				envelope: {
					mailFrom: { address: "support@example.com" },
					rcptTo: [{ address: "one@example.net" }, { address: "two@example.net" }],
				},
			},
			{ from: { value: [{ address: "support@example.com" }] } },
			creds,
		),
		/exactly one recipient/i,
	);
});
