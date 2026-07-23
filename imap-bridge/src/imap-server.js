/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";

const fs = require("fs");
const net = require("net");
const tls = require("tls");
const apiClient = require("./api-client");

const FOLDERS = ["INBOX", "Sent", "Drafts", "Spam", "Trash", "Starred"];
const CAPABILITIES = "IMAP4rev1 NAMESPACE";

function cleanHeader(value) {
	return String(value ?? "").replace(/[\r\n]+/g, " ").trim();
}

function quoteImap(value) {
	return `"${cleanHeader(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function uidValidity(mailboxId) {
	let hash = 2166136261;
	for (const character of String(mailboxId)) {
		hash ^= character.charCodeAt(0);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0) || 1;
}

function matchesNumberSet(value, numberSet, maximum) {
	if (!Number.isInteger(value) || value < 1 || maximum < 1) return false;
	for (const part of numberSet.split(",")) {
		if (part === "*" && value === maximum) return true;
		if (part.includes(":")) {
			let [start, end] = part.split(":").map((item) => item === "*" ? maximum : Number(item));
			if (!Number.isInteger(start) || !Number.isInteger(end)) continue;
			if (start > end) [start, end] = [end, start];
			if (value >= start && value <= end) return true;
			continue;
		}
		if (Number(part) === value) return true;
	}
	return false;
}

function parseAddress(value) {
	const clean = cleanHeader(value);
	const angleMatch = clean.match(/^(.*?)\s*<([^>]+)>$/);
	const displayName = angleMatch?.[1]?.replace(/^"|"$/g, "").trim() || null;
	const address = (angleMatch?.[2] || clean).trim();
	const at = address.lastIndexOf("@");
	if (at < 1 || at === address.length - 1) return { displayName, local: address, domain: null };
	return { displayName, local: address.slice(0, at), domain: address.slice(at + 1) };
}

function imapNString(value) {
	return value ? quoteImap(value) : "NIL";
}

function envelopeAddress(value) {
	const address = parseAddress(value);
	return `((${imapNString(address.displayName)} NIL ${imapNString(address.local)} ${imapNString(address.domain)}))`;
}

class ImapSession {
	constructor(socket, client = apiClient) {
		this.socket = socket;
		this.client = client;
		this.state = "not_authenticated";
		this.creds = null;
		this.selectedFolder = null;
		this.readOnly = false;
		this.messageCache = [];
		this.deletedUids = new Set();
		this.buffer = "";

		socket.on("data", (data) => {
			this.buffer += data.toString("utf8");
			const lines = this.buffer.split("\r\n");
			this.buffer = lines.pop() ?? "";
			for (const line of lines) {
				if (!line.trim()) continue;
				this.handleLine(line).catch(() => {
					const tag = line.split(" ", 1)[0] || "*";
					this.send(`${tag} NO Lumimail operation failed`);
				});
			}
		});
		socket.on("error", () => {});
		this.send("* OK Lumimail IMAP bridge ready");
	}

	send(line) {
		if (!this.socket.destroyed) this.socket.write(`${line}\r\n`);
	}

	sendUntagged(line) {
		this.send(`* ${line}`);
	}

	isAuthenticated() {
		return this.state === "authenticated" || this.state === "selected";
	}

	async handleLine(line) {
		const firstSpace = line.indexOf(" ");
		if (firstSpace < 1) return;
		const tag = line.slice(0, firstSpace);
		const rest = line.slice(firstSpace + 1).trim();
		const commandSpace = rest.indexOf(" ");
		const command = (commandSpace === -1 ? rest : rest.slice(0, commandSpace)).toUpperCase();
		const args = commandSpace === -1 ? "" : rest.slice(commandSpace + 1);

		switch (command) {
			case "CAPABILITY":
				this.sendUntagged(`CAPABILITY ${CAPABILITIES}`);
				this.send(`${tag} OK CAPABILITY completed`);
				return;
			case "NOOP":
				this.send(`${tag} OK NOOP completed`);
				return;
			case "LOGOUT":
				this.sendUntagged("BYE Lumimail IMAP bridge signing off");
				this.send(`${tag} OK LOGOUT completed`);
				this.socket.end();
				return;
			case "LOGIN":
				await this.handleLogin(tag, args);
				return;
			case "NAMESPACE":
				if (!this.isAuthenticated()) return this.send(`${tag} NO Not authenticated`);
				this.sendUntagged('NAMESPACE (("" "/")) NIL NIL');
				this.send(`${tag} OK NAMESPACE completed`);
				return;
			case "LIST":
			case "LSUB":
				this.handleList(tag, command);
				return;
			case "SELECT":
			case "EXAMINE":
				await this.handleSelect(tag, command, args);
				return;
			case "FETCH":
				await this.handleFetch(tag, args, false);
				return;
			case "STORE":
				await this.handleStore(tag, args, false);
				return;
			case "SEARCH":
				this.handleSearch(tag, args, false);
				return;
			case "UID":
				await this.handleUid(tag, args);
				return;
			case "STATUS":
				await this.handleStatus(tag, args);
				return;
			case "EXPUNGE":
				await this.handleExpunge(tag, true);
				return;
			case "CLOSE":
				if (this.state !== "selected") return this.send(`${tag} NO Not in selected state`);
				if (!this.readOnly) await this.expungeDeleted(false);
				this.clearSelection();
				this.send(`${tag} OK CLOSE completed`);
				return;
			default:
				this.send(`${tag} BAD Unknown command ${command}`);
		}
	}

	async handleLogin(tag, args) {
		if (this.state !== "not_authenticated") return this.send(`${tag} BAD Already authenticated`);
		const parts = args.match(/^"?([^" ]+)"?\s+"?([^"\s]+)"?$/);
		if (!parts) return this.send(`${tag} BAD Invalid LOGIN arguments`);
		const result = await this.client.authenticate(parts[1], parts[2], "read");
		if (!result) return this.send(`${tag} NO Invalid credentials or mailbox access`);
		this.creds = result;
		this.state = "authenticated";
		this.send(`${tag} OK LOGIN completed`);
	}

	handleList(tag, command) {
		if (!this.isAuthenticated()) return this.send(`${tag} NO Not authenticated`);
		for (const folder of FOLDERS) {
			this.sendUntagged(`${command} (\\HasNoChildren) "/" "${folder}"`);
		}
		this.send(`${tag} OK ${command} completed`);
	}

	async handleSelect(tag, command, args) {
		if (!this.isAuthenticated()) return this.send(`${tag} NO Not authenticated`);
		const folder = args.trim().replace(/^"|"$/g, "");
		if (!FOLDERS.includes(folder)) return this.send(`${tag} NO No such mailbox`);
		const page = await this.loadFolder(folder);
		this.messageCache = page.messages;
		this.selectedFolder = folder;
		this.readOnly = command === "EXAMINE";
		this.deletedUids.clear();
		this.state = "selected";
		this.sendUntagged(`${this.messageCache.length} EXISTS`);
		this.sendUntagged("0 RECENT");
		this.sendUntagged("FLAGS (\\Seen \\Flagged \\Deleted \\Draft)");
		this.sendUntagged(`OK [PERMANENTFLAGS (${this.readOnly ? "" : "\\Seen \\Deleted"})] Permanent flags`);
		this.sendUntagged(`OK [UIDVALIDITY ${uidValidity(this.creds.mailbox.id)}] UIDs valid`);
		this.sendUntagged(`OK [UIDNEXT ${page.uidNext}] Predicted next UID`);
		this.send(`${tag} OK [${this.readOnly ? "READ-ONLY" : "READ-WRITE"}] ${folder} selected`);
	}

	async handleUid(tag, args) {
		const space = args.indexOf(" ");
		const subcommand = (space === -1 ? args : args.slice(0, space)).toUpperCase();
		const subArgs = space === -1 ? "" : args.slice(space + 1);
		if (subcommand === "FETCH") return this.handleFetch(tag, subArgs, true);
		if (subcommand === "STORE") return this.handleStore(tag, subArgs, true);
		if (subcommand === "SEARCH") return this.handleSearch(tag, subArgs, true);
		this.send(`${tag} BAD Unsupported UID command ${subcommand}`);
	}

	messageFlags(message) {
		const flags = [];
		if (message.read) flags.push("\\Seen");
		if (message.starred) flags.push("\\Flagged");
		if (message.status === "draft") flags.push("\\Draft");
		if (this.deletedUids.has(message.imapUid)) flags.push("\\Deleted");
		return flags.join(" ");
	}

	selectedEntries(set, useUid) {
		if (useUid) {
			const maximum = Math.max(0, ...this.messageCache.map((message) => message.imapUid || 0));
			return this.messageCache
				.map((message, index) => ({ message, sequence: index + 1 }))
				.filter(({ message }) => matchesNumberSet(message.imapUid, set, maximum));
		}
		return this.parseNumberSet(set, this.messageCache.length)
			.map((sequence) => ({ message: this.messageCache[sequence - 1], sequence }))
			.filter(({ message }) => Boolean(message));
	}

	async handleFetch(tag, args, useUid) {
		if (this.state !== "selected") return this.send(`${tag} NO Not in selected state`);
		const space = args.indexOf(" ");
		if (space < 1) return this.send(`${tag} BAD Invalid FETCH arguments`);
		const set = args.slice(0, space);
		const requestedItems = args.slice(space + 1);
		const items = requestedItems.toUpperCase();
		for (const { message, sequence } of this.selectedEntries(set, useUid)) {
			const flags = this.messageFlags(message);
			const attributes = [`UID ${message.imapUid}`, `FLAGS (${flags})`];
			const date = new Date(message.createdAt).toUTCString().replace(/GMT$/, "+0000");
			if (items.includes("INTERNALDATE")) attributes.push(`INTERNALDATE "${date}"`);
			if (items.includes("ENVELOPE")) attributes.push(`ENVELOPE ${this.buildEnvelope(message)}`);

			const bodyMatch = /BODY(?:\.PEEK)?\[([^\]]*)\](?:<(\d+)\.(\d+)>)?/i.exec(requestedItems);
			if (bodyMatch || items.includes("RFC822")) {
				const detail = await this.client.getMessage(this.creds, message.id);
				const raw = this.buildRawEmail(message, detail);
				const rawBytes = Buffer.from(raw, "utf8");
				if (items.includes("RFC822.SIZE")) attributes.push(`RFC822.SIZE ${rawBytes.length}`);
				let responseName = "RFC822";
				let content = rawBytes;
				if (bodyMatch) {
					const section = bodyMatch[1];
					responseName = `BODY[${section}]`;
					content = this.extractBodySection(raw, section);
					if (bodyMatch[2] !== undefined && bodyMatch[3] !== undefined) {
						const start = Number(bodyMatch[2]);
						const count = Number(bodyMatch[3]);
						content = content.subarray(start, start + count);
						responseName += `<${start}>`;
					}
				}
				this.socket.write(
					`* ${sequence} FETCH (${attributes.join(" ")} ${responseName} {${content.length}}\r\n`,
				);
				this.socket.write(content);
				this.socket.write("\r\n)\r\n");
			} else {
				this.sendUntagged(`${sequence} FETCH (${attributes.join(" ")})`);
			}
		}
		this.send(`${tag} OK ${useUid ? "UID " : ""}FETCH completed`);
	}

	async handleStore(tag, args, useUid) {
		if (this.state !== "selected") return this.send(`${tag} NO Not in selected state`);
		if (this.readOnly) return this.send(`${tag} NO Mailbox is read-only`);
		const match = args.match(/^(\S+)\s+(\S+)\s+(.+)$/);
		if (!match) return this.send(`${tag} BAD Invalid STORE arguments`);
		const [, set, operation, rawFlags] = match;
		if (/\\Flagged/i.test(rawFlags)) return this.send(`${tag} NO Updating \\Flagged is not supported`);
		const silent = operation.toUpperCase().endsWith(".SILENT");
		const baseOperation = operation.toUpperCase().replace(".SILENT", "");

		for (const { message, sequence } of this.selectedEntries(set, useUid)) {
			if (/\\Seen/i.test(rawFlags)) {
				const read = baseOperation === "+FLAGS" || baseOperation === "FLAGS";
				await this.client.updateMessage(this.creds, message.id, { read });
				message.read = read;
			} else if (baseOperation === "FLAGS") {
				await this.client.updateMessage(this.creds, message.id, { read: false });
				message.read = false;
			}
			if (/\\Deleted/i.test(rawFlags)) {
				if (baseOperation === "-FLAGS") this.deletedUids.delete(message.imapUid);
				else this.deletedUids.add(message.imapUid);
			} else if (baseOperation === "FLAGS") {
				this.deletedUids.delete(message.imapUid);
			}
			if (!silent) {
				this.sendUntagged(`${sequence} FETCH (UID ${message.imapUid} FLAGS (${this.messageFlags(message)}))`);
			}
		}
		this.send(`${tag} OK ${useUid ? "UID " : ""}STORE completed`);
	}

	handleSearch(tag, args, useUid) {
		if (this.state !== "selected") return this.send(`${tag} NO Not in selected state`);
		const criteria = args.trim().toUpperCase().replace(/^CHARSET\s+\S+\s+/, "") || "ALL";
		if (!["ALL", "SEEN", "UNSEEN"].includes(criteria)) {
			return this.send(`${tag} NO Unsupported SEARCH criteria`);
		}
		const values = this.messageCache
			.map((message, index) => ({ message, sequence: index + 1 }))
			.filter(({ message }) => criteria === "ALL" || (criteria === "SEEN" ? message.read : !message.read))
			.map(({ message, sequence }) => useUid ? message.imapUid : sequence);
		this.sendUntagged(`SEARCH ${values.join(" ")}`.trimEnd());
		this.send(`${tag} OK ${useUid ? "UID " : ""}SEARCH completed`);
	}

	async handleStatus(tag, args) {
		if (!this.isAuthenticated()) return this.send(`${tag} NO Not authenticated`);
		const match = args.match(/^"?([^"]+?)"?\s+\(([^)]+)\)$/);
		if (!match || !FOLDERS.includes(match[1])) return this.send(`${tag} NO No such mailbox`);
		const folder = match[1];
		const page = await this.loadFolder(folder);
		const unseen = page.messages.filter((message) => !message.read).length;
		this.sendUntagged(
			`STATUS "${folder}" (MESSAGES ${page.messages.length} UNSEEN ${unseen} RECENT 0 UIDNEXT ${page.uidNext} UIDVALIDITY ${uidValidity(this.creds.mailbox.id)})`,
		);
		this.send(`${tag} OK STATUS completed`);
	}

	async expungeDeleted(emitResponses) {
		const entries = this.messageCache
			.map((message, index) => ({ message, sequence: index + 1 }))
			.filter(({ message }) => this.deletedUids.has(message.imapUid))
			.sort((left, right) => right.sequence - left.sequence);
		for (const { message, sequence } of entries) {
			await this.client.updateMessage(this.creds, message.id, { status: "trash" });
			this.messageCache.splice(sequence - 1, 1);
			this.deletedUids.delete(message.imapUid);
			if (emitResponses) this.sendUntagged(`${sequence} EXPUNGE`);
		}
	}

	async handleExpunge(tag, emitResponses) {
		if (this.state !== "selected") return this.send(`${tag} NO Not in selected state`);
		if (this.readOnly) return this.send(`${tag} NO Mailbox is read-only`);
		await this.expungeDeleted(emitResponses);
		this.send(`${tag} OK EXPUNGE completed`);
	}

	clearSelection() {
		this.state = "authenticated";
		this.selectedFolder = null;
		this.readOnly = false;
		this.messageCache = [];
		this.deletedUids.clear();
	}

	parseNumberSet(numberSet, maximum) {
		if (maximum < 1) return [];
		const values = new Set();
		for (const part of numberSet.split(",")) {
			if (part === "*") {
				values.add(maximum);
				continue;
			}
			if (part.includes(":")) {
				let [start, end] = part.split(":").map((value) => value === "*" ? maximum : Number(value));
				if (!Number.isInteger(start) || !Number.isInteger(end)) continue;
				if (start > end) [start, end] = [end, start];
				for (let value = Math.max(1, start); value <= Math.min(end, maximum); value += 1) values.add(value);
				continue;
			}
			const value = Number(part);
			if (Number.isInteger(value) && value >= 1 && value <= maximum) values.add(value);
		}
		return [...values].sort((left, right) => left - right);
	}

	async loadFolder(folder) {
		const messages = [];
		let offset = 0;
		let uidNext = 1;
		for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
			const page = await this.client.listMessages(this.creds, folder, { limit: 100, offset });
			messages.push(...page.messages);
			uidNext = page.uidNext;
			if (!page.hasMore) return { messages, uidNext };
			offset += 100;
		}
		throw new Error("Mailbox exceeds bridge synchronization limit");
	}

	buildEnvelope(message) {
		const date = new Date(message.createdAt).toUTCString();
		const from = envelopeAddress(message.fromAddr);
		const to = envelopeAddress(message.toAddr);
		return `(${quoteImap(date)} ${quoteImap(message.subject || "")} ${from} ${from} ${from} ${to} NIL NIL NIL ${quoteImap(`<${cleanHeader(message.id)}@lumimail>`)})`;
	}

	extractBodySection(raw, requestedSection) {
		const boundary = raw.indexOf("\r\n\r\n");
		const headers = boundary === -1 ? `${raw}\r\n\r\n` : raw.slice(0, boundary + 4);
		const body = boundary === -1 ? "" : raw.slice(boundary + 4);
		const section = requestedSection.trim().toUpperCase();
		if (!section) return Buffer.from(raw, "utf8");
		if (section === "HEADER") return Buffer.from(headers, "utf8");
		if (section === "TEXT" || /^\d+(?:\.\d+)*$/.test(section)) return Buffer.from(body, "utf8");
		const fieldsMatch = section.match(/^HEADER\.FIELDS\s+\(([^)]+)\)$/);
		if (fieldsMatch) {
			const requested = new Set(fieldsMatch[1].split(/\s+/).map((field) => field.toLowerCase()));
			const selected = headers
				.slice(0, -4)
				.split("\r\n")
				.filter((line) => requested.has(line.slice(0, line.indexOf(":")).toLowerCase()));
			return Buffer.from(`${selected.join("\r\n")}\r\n\r\n`, "utf8");
		}
		throw new Error(`Unsupported BODY section: ${requestedSection}`);
	}

	buildRawEmail(message, detail) {
		const body = detail?.body || detail || {};
		const textBody = body.textBody || message.snippet || "";
		const htmlBody = body.htmlBody;
		const headers = [
			`From: ${cleanHeader(message.fromAddr)}`,
			`To: ${cleanHeader(message.toAddr)}`,
			`Subject: ${cleanHeader(message.subject || "(no subject)")}`,
			`Date: ${new Date(message.createdAt).toUTCString()}`,
			`Message-ID: <${cleanHeader(message.id)}@lumimail>`,
			"MIME-Version: 1.0",
		];
		if (!htmlBody) {
			return `${headers.join("\r\n")}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${textBody}`;
		}
		const boundary = `lumimail_${cleanHeader(message.id).replace(/[^a-zA-Z0-9_-]/g, "")}`;
		return [
			...headers,
			`Content-Type: multipart/alternative; boundary="${boundary}"`,
			"",
			`--${boundary}`,
			"Content-Type: text/plain; charset=utf-8",
			"",
			textBody,
			`--${boundary}`,
			"Content-Type: text/html; charset=utf-8",
			"",
			htmlBody,
			`--${boundary}--`,
			"",
		].join("\r\n");
	}
}

function startImapServer(config, client = apiClient) {
	const listener = (socket) => new ImapSession(socket, client);
	const server = config.imapTls
		? tls.createServer({
			key: fs.readFileSync(config.tlsKeyPath),
			cert: fs.readFileSync(config.tlsCertPath),
		}, listener)
		: net.createServer(listener);
	server.on("error", (error) => console.error("IMAP bridge error:", error.message));
	server.listen(config.imapPort, config.host, () => {
		console.log(`IMAP bridge listening on ${config.host}:${config.imapPort}`);
	});
	return server;
}

module.exports = {
	CAPABILITIES,
	FOLDERS,
	ImapSession,
	cleanHeader,
	quoteImap,
	matchesNumberSet,
	startImapServer,
	uidValidity,
};
