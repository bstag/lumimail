/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { resolveTransportConfig } = require("../src/transport-config");

test("production requires HTTPS API and a complete certificate pair", () => {
	assert.throws(
		() => resolveTransportConfig({ LUMIMAIL_API_URL: "http://mail.example.test" }),
		/HTTPS/,
	);
	assert.throws(
		() => resolveTransportConfig({
			LUMIMAIL_API_URL: "https://mail.example.test",
			TLS_KEY_PATH: "/key.pem",
		}),
		/certificate/i,
	);
	assert.throws(
		() => resolveTransportConfig({ LUMIMAIL_API_URL: "https://mail.example.test" }),
		/TLS/,
	);
});

test("explicit insecure development mode binds only loopback", () => {
	const config = resolveTransportConfig({
		LUMIMAIL_API_URL: "http://127.0.0.1:3000",
		ALLOW_INSECURE_LOCALHOST: "true",
		BRIDGE_HOST: "0.0.0.0",
	});

	assert.equal(config.host, "127.0.0.1");
	assert.equal(config.allowInsecure, true);
	assert.equal(config.imapTls, false);
	assert.equal(config.smtpStartTls, false);
});

test("production config enables implicit IMAP TLS and SMTP STARTTLS", () => {
	const config = resolveTransportConfig({
		LUMIMAIL_API_URL: "https://mail.example.test",
		TLS_KEY_PATH: "/key.pem",
		TLS_CERT_PATH: "/cert.pem",
	});

	assert.equal(config.host, "0.0.0.0");
	assert.equal(config.imapTls, true);
	assert.equal(config.smtpStartTls, true);
});
