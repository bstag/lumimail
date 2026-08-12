import { randomBytes } from "node:crypto";
import {
	existsSync,
	lstatSync,
	readFileSync,
	readdirSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { gzipSync } from "node:zlib";

const BLOCK_SIZE = 512;

export class ReleaseArchiveError extends Error {
	constructor(message = "Release archive input is unsafe. No archive was published.") {
		super(message);
		this.name = "ReleaseArchiveError";
		this.code = "UNSAFE_RELEASE_ARCHIVE";
	}
}

function fail() {
	throw new ReleaseArchiveError();
}

function normalizeEntry(entry) {
	if (!entry || !["file", "directory"].includes(entry.type) || typeof entry.path !== "string") fail();
	if (
		!entry.path || isAbsolute(entry.path) || entry.path.includes("\\") || entry.path.includes("\0") ||
		entry.path.startsWith("/") || entry.path.endsWith("/") ||
		entry.path.split("/").some((segment) => !segment || segment === "." || segment === "..")
	) fail();
	if (entry.type === "file" && !(entry.bytes instanceof Uint8Array)) fail();
	if (entry.type === "directory" && entry.bytes !== undefined) fail();
	return {
		path: entry.type === "directory" ? `${entry.path}/` : entry.path,
		type: entry.type,
		bytes: entry.type === "file" ? Buffer.from(entry.bytes) : Buffer.alloc(0),
	};
}

function splitUstarPath(path) {
	const bytes = Buffer.byteLength(path);
	if (bytes <= 100) return { name: path, prefix: "" };
	for (let index = path.lastIndexOf("/"); index > 0; index = path.lastIndexOf("/", index - 1)) {
		const prefix = path.slice(0, index);
		const name = path.slice(index + 1);
		if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) return { name, prefix };
	}
	fail();
}

function writeText(header, offset, length, value) {
	const bytes = Buffer.from(value, "utf8");
	if (bytes.length > length) fail();
	bytes.copy(header, offset);
}

function writeOctal(header, offset, length, value) {
	const octal = value.toString(8).padStart(length - 1, "0");
	if (octal.length !== length - 1) fail();
	writeText(header, offset, length, `${octal}\0`);
}

function tarHeader(entry) {
	const header = Buffer.alloc(BLOCK_SIZE);
	const { name, prefix } = splitUstarPath(entry.path);
	writeText(header, 0, 100, name);
	writeOctal(header, 100, 8, entry.type === "directory" ? 0o755 : 0o644);
	writeOctal(header, 108, 8, 0);
	writeOctal(header, 116, 8, 0);
	writeOctal(header, 124, 12, entry.bytes.length);
	writeOctal(header, 136, 12, 0);
	header.fill(0x20, 148, 156);
	writeText(header, 156, 1, entry.type === "directory" ? "5" : "0");
	writeText(header, 257, 6, "ustar\0");
	writeText(header, 263, 2, "00");
	writeText(header, 345, 155, prefix);
	let checksum = 0;
	for (const byte of header) checksum += byte;
	const checksumText = checksum.toString(8).padStart(6, "0");
	if (checksumText.length !== 6) fail();
	writeText(header, 148, 8, `${checksumText}\0 `);
	return header;
}

export function createDeterministicTarGzip(entries) {
	if (!Array.isArray(entries)) fail();
	const normalized = entries.map(normalizeEntry);
	const paths = normalized.map((entry) => entry.path);
	if (new Set(paths).size !== paths.length) fail();
	normalized.sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
	const chunks = [];
	for (const entry of normalized) {
		chunks.push(tarHeader(entry), entry.bytes);
		const padding = (BLOCK_SIZE - (entry.bytes.length % BLOCK_SIZE)) % BLOCK_SIZE;
		if (padding) chunks.push(Buffer.alloc(padding));
	}
	chunks.push(Buffer.alloc(BLOCK_SIZE * 2));
	const archive = gzipSync(Buffer.concat(chunks), { level: 9 });
	archive.fill(0, 4, 8);
	archive[9] = 255;
	return archive;
}

function collectEntries(root) {
	const entries = [];
	function walk(directory, prefix = "") {
		const names = readdirSync(directory).sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
		for (const name of names) {
			const absolute = resolve(directory, name);
			const path = prefix ? `${prefix}/${name}` : name;
			const stat = lstatSync(absolute);
			if (stat.isSymbolicLink()) fail();
			if (stat.isDirectory()) {
				entries.push({ path, type: "directory" });
				walk(absolute, path);
			} else if (stat.isFile()) {
				entries.push({ path, type: "file", bytes: readFileSync(absolute) });
			} else {
				fail();
			}
		}
	}
	walk(root);
	return entries;
}

function isWithin(parent, candidate) {
	const path = relative(parent, candidate);
	return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

export function writeReleaseArchive(sourceDirectory, outputFile) {
	const source = resolve(sourceDirectory);
	const output = resolve(outputFile);
	let sourceIsDirectory = false;
	try {
		sourceIsDirectory = lstatSync(source).isDirectory();
	} catch {
		fail();
	}
	if (!sourceIsDirectory || existsSync(output) || isWithin(source, output) || !existsSync(dirname(output))) fail();
	const partial = `${output}.partial-${randomBytes(8).toString("hex")}`;
	try {
		const firstEntries = collectEntries(source);
		const first = createDeterministicTarGzip(firstEntries);
		const second = createDeterministicTarGzip(collectEntries(source));
		if (!first.equals(second)) fail();
		writeFileSync(partial, first, { flag: "wx" });
		renameSync(partial, output);
		return Object.freeze({ outputPath: output, archiveSize: first.length, entryCount: firstEntries.length });
	} catch (error) {
		rmSync(partial, { force: true });
		if (error instanceof ReleaseArchiveError) throw error;
		throw new ReleaseArchiveError();
	}
}
