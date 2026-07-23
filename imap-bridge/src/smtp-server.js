/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";

const fs = require("fs");
const { SMTPServer } = require("smtp-server");
const { simpleParser } = require("mailparser");
const apiClient = require("./api-client");

const MAX_MESSAGE_BYTES = 25 * 1024 * 1024;

function smtpError(message, responseCode = 550) {
	const error = new Error(message);
	error.responseCode = responseCode;
	return error;
}

function normalizeAddress(value) {
	return String(value || "").trim().toLowerCase();
}

function normalizeSubmission(session, parsed, creds) {
	const envelopeFrom = normalizeAddress(session.envelope?.mailFrom?.address);
	const headerFrom = normalizeAddress(parsed.from?.value?.[0]?.address);
	const authorizedFrom = normalizeAddress(creds.mailbox.address);
	if (!envelopeFrom || envelopeFrom !== authorizedFrom || headerFrom !== authorizedFrom) {
		throw smtpError("Sender is not authorized for this mailbox", 553);
	}

	const recipients = (session.envelope?.rcptTo || [])
		.map((recipient) => normalizeAddress(recipient.address))
		.filter(Boolean);
	if (recipients.length !== 1) throw smtpError("Exactly one recipient is supported", 452);

	return {
		to: recipients[0],
		subject: parsed.subject || "",
		text: parsed.text || "",
		html: typeof parsed.html === "string" && parsed.html ? parsed.html : undefined,
	};
}

function createSmtpServer(config, client = apiClient) {
	const sessions = new Map();
	const options = {
		secure: false,
		authOptional: false,
		size: MAX_MESSAGE_BYTES,
		disabledCommands: config.smtpStartTls ? [] : ["STARTTLS"],

		onAuth(auth, session, callback) {
			client.authenticate(auth.username, auth.password, "send")
				.then((result) => {
					if (!result) return callback(smtpError("Invalid credentials", 535));
					sessions.set(session.id, result);
					callback(null, { user: result.user.id });
				})
				.catch(() => callback(smtpError("Authentication service unavailable", 454)));
		},

		onRcptTo(_address, session, callback) {
			if ((session.envelope?.rcptTo?.length || 0) >= 1) {
				return callback(smtpError("Exactly one recipient is supported", 452));
			}
			callback();
		},

		onData(stream, session, callback) {
			const creds = sessions.get(session.id);
			if (!creds) return callback(smtpError("Not authenticated", 530));

			const chunks = [];
			let size = 0;
			let completed = false;
			const finish = (error) => {
				if (completed) return;
				completed = true;
				callback(error);
			};

			stream.on("data", (chunk) => {
				size += chunk.length;
				if (size > MAX_MESSAGE_BYTES) {
					finish(smtpError("Message exceeds 25 MB limit", 552));
					stream.resume();
					return;
				}
				chunks.push(chunk);
			});
			stream.on("error", () => finish(smtpError("Unable to read message", 451)));
			stream.on("end", async () => {
				if (completed) return;
				try {
					const parsed = await simpleParser(Buffer.concat(chunks));
					const submission = normalizeSubmission(session, parsed, creds);
					await client.sendMessage(creds, submission);
					finish();
				} catch (error) {
					finish(error.responseCode ? error : smtpError("Lumimail send failed", 451));
				}
			});
		},

		onClose(session) {
			sessions.delete(session.id);
		},
	};

	if (config.smtpStartTls) {
		options.key = fs.readFileSync(config.tlsKeyPath);
		options.cert = fs.readFileSync(config.tlsCertPath);
	}
	return new SMTPServer(options);
}

function startSmtpServer(config, client = apiClient) {
	const server = createSmtpServer(config, client);
	server.on("error", (error) => console.error("SMTP bridge error:", error.message));
	server.listen(config.smtpPort, config.host, () => {
		console.log(`SMTP bridge listening on ${config.host}:${config.smtpPort}`);
	});
	return server;
}

module.exports = {
	MAX_MESSAGE_BYTES,
	normalizeSubmission,
	createSmtpServer,
	startSmtpServer,
};
