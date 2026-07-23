/* eslint-disable */
"use strict";

require("dotenv").config();

const { startImapServer } = require("./imap-server");
const { startSmtpServer } = require("./smtp-server");
const { resolveTransportConfig } = require("./transport-config");

const config = resolveTransportConfig();

console.log("Starting Lumimail IMAP/SMTP bridge...");
console.log(`API origin: ${new URL(config.apiUrl).origin}`);
startImapServer(config);
startSmtpServer(config);
