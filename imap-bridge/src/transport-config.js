"use strict";

function parsePort(value, fallback, name) {
	const port = Number(value ?? fallback);
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error(`${name} must be a valid TCP port`);
	}
	return port;
}

function resolveTransportConfig(env = process.env) {
	const apiUrl = new URL(env.LUMIMAIL_API_URL || "https://mail.yourdomain.com");
	const allowInsecure = env.ALLOW_INSECURE_LOCALHOST === "true";
	const hasKey = Boolean(env.TLS_KEY_PATH);
	const hasCert = Boolean(env.TLS_CERT_PATH);

	if (allowInsecure) {
		if (!["127.0.0.1", "localhost", "::1"].includes(apiUrl.hostname)) {
			throw new Error("Insecure development mode requires a loopback Lumimail API URL");
		}
		return {
			apiUrl: apiUrl.toString().replace(/\/$/, ""),
			allowInsecure: true,
			host: "127.0.0.1",
			imapPort: parsePort(env.IMAP_PORT, 1143, "IMAP_PORT"),
			smtpPort: parsePort(env.SMTP_PORT, 1587, "SMTP_PORT"),
			imapTls: false,
			smtpStartTls: false,
			tlsKeyPath: null,
			tlsCertPath: null,
		};
	}

	if (apiUrl.protocol !== "https:") throw new Error("Production Lumimail API URL must use HTTPS");
	if (hasKey !== hasCert) throw new Error("Both TLS key and certificate paths are required");
	if (!hasKey || !hasCert) throw new Error("TLS key and certificate are required in production");

	return {
		apiUrl: apiUrl.toString().replace(/\/$/, ""),
		allowInsecure: false,
		host: env.BRIDGE_HOST || "0.0.0.0",
		imapPort: parsePort(env.IMAPS_PORT, 993, "IMAPS_PORT"),
		smtpPort: parsePort(env.SMTP_PORT, 587, "SMTP_PORT"),
		imapTls: true,
		smtpStartTls: true,
		tlsKeyPath: env.TLS_KEY_PATH,
		tlsCertPath: env.TLS_CERT_PATH,
	};
}

module.exports = { resolveTransportConfig };
