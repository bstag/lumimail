/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";

const assert = require("node:assert/strict");
const { afterEach, beforeEach, test } = require("node:test");

process.env.LUMIMAIL_API_URL = "https://mail.example.test";

let requests;
let originalFetch;

beforeEach(() => {
	requests = [];
	originalFetch = global.fetch;
});

afterEach(() => {
	global.fetch = originalFetch;
});

function jsonResponse(body, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

test("authentication binds the requested mailbox and read capability", async () => {
	global.fetch = async (url, options) => {
		requests.push({ url: String(url), options });
		return jsonResponse({
			success: true,
			data: {
				user: { id: "u1", email: "person@example.net" },
				scopes: ["read", "send"],
				mailboxes: [
					{
						id: "mb1",
						address: "support@example.com",
						role: "responder",
						canRead: true,
						canSend: true,
					},
				],
			},
		});
	};
	const { authenticate } = require("../src/api-client");

	const result = await authenticate("SUPPORT@example.com ", "ep_secret", "read");

	assert.equal(result.mailbox.id, "mb1");
	assert.equal(result.mailbox.address, "support@example.com");
	assert.equal(result.apiKey, "ep_secret");
	assert.equal(requests[0].url, "https://mail.example.test/api/v1/session");
	assert.equal(requests[0].options.headers.Authorization, "Bearer ep_secret");
});

test("authentication rejects an unassigned mailbox or missing capability", async () => {
	global.fetch = async () => jsonResponse({
		success: true,
		data: {
			user: { id: "u1", email: "person@example.net" },
			scopes: ["read"],
			mailboxes: [
				{ id: "mb1", address: "info@example.com", role: "viewer", canRead: true, canSend: false },
			],
		},
	});
	const { authenticate } = require("../src/api-client");

	assert.equal(await authenticate("other@example.com", "ep_secret", "read"), null);
	assert.equal(await authenticate("info@example.com", "ep_secret", "send"), null);
});

test("list, detail, state, and send use only canonical v1 contracts", async () => {
	global.fetch = async (url, options) => {
		requests.push({ url: String(url), options });
		if (String(url).includes("/api/v1/messages/msg1") && options.method === "PATCH") {
			return jsonResponse({ success: true, data: { message: { id: "msg1", read: false } } });
		}
		if (String(url).includes("/api/v1/messages/msg1")) {
			return jsonResponse({
				success: true,
				data: { message: { id: "msg1" }, body: { textBody: "hello", htmlBody: null } },
			});
		}
		if (String(url).includes("/api/v1/messages")) {
			return jsonResponse({
				success: true,
				data: { messages: [{ id: "msg1", imapUid: 10 }], hasMore: false, uidNext: 51 },
			});
		}
		return jsonResponse({ success: true, data: { messageId: "sent1" } });
	};
	const client = require("../src/api-client");
	const creds = {
		apiKey: "ep_secret",
		mailbox: { id: "mb1", address: "support@example.com" },
	};

	assert.deepEqual(await client.listMessages(creds, "INBOX"), {
		messages: [{ id: "msg1", imapUid: 10 }],
		hasMore: false,
		uidNext: 51,
	});
	assert.equal((await client.getMessage(creds, "msg1")).body.textBody, "hello");
	await client.updateMessage(creds, "msg1", { read: false });
	await client.sendMessage(creds, {
		to: "recipient@example.net",
		subject: "Hi",
		text: "Body",
	});

	assert.ok(requests.every(({ url }) => url.includes("/api/v1/")));
	assert.match(requests[0].url, /mailboxId=mb1/);
	const sendBody = JSON.parse(requests.at(-1).options.body);
	assert.deepEqual(sendBody, {
		from: "support@example.com",
		to: "recipient@example.net",
		subject: "Hi",
		text: "Body",
		mailboxId: "mb1",
	});
});

test("API errors propagate instead of becoming an empty mailbox", async () => {
	global.fetch = async () => jsonResponse({
		success: false,
		error: { message: "Forbidden" },
	}, 403);
	const { listMessages } = require("../src/api-client");

	await assert.rejects(
		() => listMessages({ apiKey: "ep_secret", mailbox: { id: "mb1" } }, "INBOX"),
		/Forbidden/,
	);
});
