/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");

const { ImapSession, CAPABILITIES, matchesNumberSet } = require("../src/imap-server");

class FakeSocket extends EventEmitter {
	constructor() {
		super();
		this.output = "";
		this.ended = false;
	}

	write(value) {
		this.output += String(value);
		return true;
	}

	end() {
		this.ended = true;
	}
}

test("capabilities are truthful and omit unimplemented transport/auth extensions", () => {
	assert.match(CAPABILITIES, /\bIMAP4rev1\b/);
	assert.match(CAPABILITIES, /\bNAMESPACE\b/);
	for (const unsupported of ["STARTTLS", "IDLE", "ENABLE", "AUTH=PLAIN", "AUTH=LOGIN", "LITERAL+"]) {
		assert.doesNotMatch(CAPABILITIES, new RegExp(unsupported.replace("+", "\\+")));
	}
});

test("UID command dispatches UID FETCH and preserves persisted UIDs", async () => {
	const socket = new FakeSocket();
	const session = new ImapSession(socket, {
		authenticate: async () => null,
		listMessages: async () => ({ messages: [], uidNext: 1 }),
		getMessage: async () => null,
		updateMessage: async () => null,
	});
	session.state = "selected";
	session.creds = { apiKey: "secret", mailbox: { id: "mb1", address: "support@example.com" } };
	session.messageCache = [
		{ id: "m1", imapUid: 44, read: false, createdAt: "2026-07-23T00:00:00Z", fromAddr: "a@x.test", toAddr: "support@example.com" },
	];
	socket.output = "";

	await session.handleLine("A1 UID FETCH 44 (UID FLAGS)");

	assert.match(socket.output, /\* 1 FETCH \(UID 44 FLAGS \(\)\)/);
	assert.match(socket.output, /A1 OK UID FETCH completed/);
});

test("UID range matching does not expand sparse global UID ranges", () => {
	assert.equal(matchesNumberSet(44, "1:2147483647", 2147483647), true);
	assert.equal(matchesNumberSet(44, "1:40,50:*", 2147483647), false);
	assert.equal(matchesNumberSet(2147483647, "*", 2147483647), true);
});

test("folder selection follows bounded API pages and uses persistent UIDNEXT", async () => {
	const socket = new FakeSocket();
	const calls = [];
	const session = new ImapSession(socket, {
		listMessages: async (_creds, _folder, options) => {
			calls.push(options);
			if (options.offset === 0) {
				return {
					messages: [{ id: "m1", imapUid: 10 }],
					hasMore: true,
					uidNext: 90,
				};
			}
			return {
				messages: [{ id: "m2", imapUid: 11 }],
				hasMore: false,
				uidNext: 90,
			};
		},
	});
	session.state = "authenticated";
	session.creds = { mailbox: { id: "mb1" } };
	socket.output = "";

	await session.handleLine("A1 SELECT INBOX");

	assert.deepEqual(calls, [{ limit: 100, offset: 0 }, { limit: 100, offset: 100 }]);
	assert.match(socket.output, /\* 2 EXISTS/);
	assert.match(socket.output, /\[UIDNEXT 90\]/);
});

test("FETCH returns requested envelope and header-fields literal", async () => {
	const socket = new FakeSocket();
	const session = new ImapSession(socket, {
		getMessage: async () => ({
			body: { textBody: "Body ☃", htmlBody: null },
		}),
	});
	session.state = "selected";
	session.creds = { mailbox: { id: "mb1" } };
	session.messageCache = [{
		id: "m1",
		imapUid: 44,
		read: false,
		createdAt: "2026-07-23T00:00:00Z",
		fromAddr: "Sender <sender@example.com>",
		toAddr: "Support <support@example.com>",
		subject: "Hello",
	}];
	socket.output = "";

	await session.handleLine(
		"A1 UID FETCH 44 (UID FLAGS ENVELOPE BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT DATE MESSAGE-ID)])",
	);

	assert.match(socket.output, /ENVELOPE \(/);
	assert.match(socket.output, /BODY\[HEADER\.FIELDS \(FROM TO SUBJECT DATE MESSAGE-ID\)\] \{\d+\}\r\n/);
	assert.match(socket.output, /Subject: Hello\r\n/);
	assert.doesNotMatch(socket.output, /Content-Type: text\/plain/);
	assert.match(socket.output, /A1 OK UID FETCH completed/);
});

test("unsupported search criteria return NO rather than every message", async () => {
	const socket = new FakeSocket();
	const session = new ImapSession(socket, {});
	session.state = "selected";
	session.messageCache = [{ id: "m1", imapUid: 44, read: false }];
	socket.output = "";

	await session.handleLine("A1 SEARCH SUBJECT secret");

	assert.match(socket.output, /A1 NO Unsupported SEARCH criteria/);
	assert.doesNotMatch(socket.output, /\* SEARCH 1/);
});

test("MIME literals use byte length and strip injected header newlines", async () => {
	const socket = new FakeSocket();
	const session = new ImapSession(socket, {});
	const raw = session.buildRawEmail(
		{
			id: "m1",
			fromAddr: "sender@example.com\r\nBcc: hidden@example.com",
			toAddr: "support@example.com",
			subject: "héllo\r\nX-Evil: yes",
			createdAt: "2026-07-23T00:00:00Z",
			snippet: "",
		},
		{ body: { textBody: "snowman ☃", htmlBody: null } },
	);

	assert.doesNotMatch(raw, /\r\nBcc:/);
	assert.doesNotMatch(raw, /\r\nX-Evil:/);
	assert.ok(Buffer.byteLength(raw, "utf8") > raw.length);
});
