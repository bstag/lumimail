import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(root, "public");
const source = await readFile(path.join(publicDir, "brand", "picket-mark.svg"), "utf8");

function themedMark(boundary) {
	return Buffer.from(source.replaceAll("#0D1524", boundary));
}

async function renderIcon(filename, size, { background, boundary, scale }) {
	const markSize = Math.round(size * scale);
	const mark = await sharp(themedMark(boundary))
		.resize(markSize, markSize, { fit: "contain" })
		.png()
		.toBuffer();

	await sharp({
		create: {
			width: size,
			height: size,
			channels: 4,
			background,
		},
	})
		.composite([{ input: mark, gravity: "centre" }])
		.png()
		.toFile(path.join(publicDir, filename));
}

const regular = { background: "#F6F8FB", boundary: "#0D1524", scale: 0.76 };
const maskable = { background: "#0D1524", boundary: "#F6F8FB", scale: 0.58 };

await Promise.all([
	renderIcon("icon-48.png", 48, regular),
	renderIcon("icon-96.png", 96, regular),
	renderIcon("icon-192.png", 192, regular),
	renderIcon("icon-512.png", 512, regular),
	renderIcon("apple-touch-icon.png", 180, regular),
	renderIcon("icon-maskable-192.png", 192, maskable),
	renderIcon("icon-maskable-512.png", 512, maskable),
]);

const faviconPng = await sharp(themedMark("#0D1524"))
	.resize(32, 32, { fit: "contain" })
	.png()
	.toBuffer();
const header = Buffer.alloc(22);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
header.writeUInt8(32, 6);
header.writeUInt8(32, 7);
header.writeUInt16LE(1, 10);
header.writeUInt16LE(32, 12);
header.writeUInt32LE(faviconPng.length, 14);
header.writeUInt32LE(header.length, 18);
await writeFile(path.join(publicDir, "favicon.ico"), Buffer.concat([header, faviconPng]));
