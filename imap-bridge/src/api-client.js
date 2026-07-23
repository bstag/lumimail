"use strict";

const LUMIMAIL_API_URL = (process.env.LUMIMAIL_API_URL || "https://mail.yourdomain.com").replace(/\/+$/, "");

class LumimailApiError extends Error {
	constructor(message, status) {
		super(message);
		this.name = "LumimailApiError";
		this.status = status;
	}
}

async function apiRequest(path, options = {}, apiKey) {
	const response = await fetch(`${LUMIMAIL_API_URL}${path}`, {
		...options,
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
			...options.headers,
		},
	});
	let payload;
	try {
		payload = await response.json();
	} catch {
		throw new LumimailApiError(`Lumimail API returned invalid JSON (${response.status})`, response.status);
	}
	if (!response.ok || payload?.success !== true) {
		throw new LumimailApiError(
			payload?.error?.message || `Lumimail API request failed (${response.status})`,
			response.status,
		);
	}
	return payload.data;
}

async function authenticate(username, password, requiredCapability) {
	try {
		const data = await apiRequest("/api/v1/session", {}, password);
		const normalizedUsername = username.trim().toLowerCase();
		const mailbox = data.mailboxes.find(
			(candidate) => candidate.address.trim().toLowerCase() === normalizedUsername,
		);
		if (!mailbox) return null;
		if (!data.scopes.includes(requiredCapability) && !data.scopes.includes("*")) return null;
		if (requiredCapability === "read" && !mailbox.canRead) return null;
		if (requiredCapability === "send" && !mailbox.canSend) return null;
		return { user: data.user, mailbox, scopes: data.scopes, apiKey: password };
	} catch {
		return null;
	}
}

function folderQuery(folder) {
	switch (folder) {
		case "INBOX":
			return { direction: "inbound", status: "received" };
		case "Sent":
			return { direction: "outbound", status: "sent" };
		case "Drafts":
			return { direction: "outbound", status: "draft" };
		case "Spam":
		case "Junk":
			return { status: "spam" };
		case "Trash":
			return { status: "trash" };
		case "Starred":
			return { starred: "true" };
		default:
			throw new Error(`Unknown folder: ${folder}`);
	}
}

async function listMessages(creds, folder, { limit = 100, offset = 0 } = {}) {
	const params = new URLSearchParams({
		mailboxId: creds.mailbox.id,
		limit: String(limit),
		offset: String(offset),
		...folderQuery(folder),
	});
	const data = await apiRequest(`/api/v1/messages?${params}`, {}, creds.apiKey);
	return data;
}

async function getMessage(creds, messageId) {
	const params = new URLSearchParams({ mailboxId: creds.mailbox.id });
	return apiRequest(`/api/v1/messages/${encodeURIComponent(messageId)}?${params}`, {}, creds.apiKey);
}

async function updateMessage(creds, messageId, change) {
	const params = new URLSearchParams({ mailboxId: creds.mailbox.id });
	return apiRequest(`/api/v1/messages/${encodeURIComponent(messageId)}?${params}`, {
		method: "PATCH",
		body: JSON.stringify(change),
	}, creds.apiKey);
}

async function sendMessage(creds, { to, subject, text, html }) {
	return apiRequest("/api/v1/send", {
		method: "POST",
		body: JSON.stringify({
			from: creds.mailbox.address,
			to,
			subject,
			text,
			...(html ? { html } : {}),
			mailboxId: creds.mailbox.id,
		}),
	}, creds.apiKey);
}

module.exports = {
	LumimailApiError,
	authenticate,
	listMessages,
	getMessage,
	updateMessage,
	sendMessage,
};
