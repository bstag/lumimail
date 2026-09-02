import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(root, "public");
const brandDir = path.join(publicDir, "brand");
const derivedDir = path.join(root, "mantle", "derived");
const sourceLockup = path.join(root, "mantle", "sigils", "primary-sigil-transparent.png");
const markBounds = { left: 102, top: 344, width: 290, height: 336 };
const signalSeed = { x: 128, y: 166 };

await Promise.all([mkdir(brandDir, { recursive: true }), mkdir(derivedDir, { recursive: true })]);

// The source lockup contains the mark and live-text replacement artwork. This exact
// crop is the visual oracle: no resize, trim, trace, or hand-redraw is allowed here.
const reference = await sharp(sourceLockup).extract(markBounds).ensureAlpha().png().toBuffer();
await writeFile(path.join(derivedDir, "primary-mark-reference.png"), reference);

const { data: pixels, info } = await sharp(reference).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const boundaryPixels = Buffer.alloc(pixels.length, 255);
const signalPixels = Buffer.alloc(pixels.length, 255);
const signalComponent = new Uint8Array(info.width * info.height);
const queue = [signalSeed.y * info.width + signalSeed.x];
signalComponent[queue[0]] = 1;

for (let cursor = 0; cursor < queue.length; cursor += 1) {
	const pixel = queue[cursor];
	const x = pixel % info.width;
	const y = Math.floor(pixel / info.width);
	for (let nextY = Math.max(0, y - 1); nextY <= Math.min(info.height - 1, y + 1); nextY += 1) {
		for (let nextX = Math.max(0, x - 1); nextX <= Math.min(info.width - 1, x + 1); nextX += 1) {
			const next = nextY * info.width + nextX;
			if (signalComponent[next] || pixels[next * 4 + 3] === 0) continue;
			signalComponent[next] = 1;
			queue.push(next);
		}
	}
}

for (let y = 0; y < info.height; y += 1) {
	for (let x = 0; x < info.width; x += 1) {
		const alphaOffset = (y * info.width + x) * 4 + 3;
		const sourceAlpha = pixels[alphaOffset];
		const isSignal = signalComponent[y * info.width + x] === 1;
		boundaryPixels[alphaOffset] = isSignal ? 0 : sourceAlpha;
		signalPixels[alphaOffset] = isSignal ? sourceAlpha : 0;
	}
}

const raw = { raw: { width: info.width, height: info.height, channels: 4 } };
const boundaryMask = await sharp(boundaryPixels, raw).png().toBuffer();
const signalMask = await sharp(signalPixels, raw).png().toBuffer();
await Promise.all([
	writeFile(path.join(brandDir, "picket-mark-boundary-mask.png"), boundaryMask),
	writeFile(path.join(brandDir, "picket-mark-signal-mask.png"), signalMask),
]);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 290 336">
  <defs>
    <mask id="boundary"><image width="290" height="336" href="picket-mark-boundary-mask.png"/></mask>
    <mask id="signal"><image width="290" height="336" href="picket-mark-signal-mask.png"/></mask>
  </defs>
  <rect width="290" height="336" fill="#0D1524" mask="url(#boundary)"/>
  <rect width="290" height="336" fill="#E06A3B" mask="url(#signal)"/>
</svg>
`;
await writeFile(path.join(brandDir, "picket-mark.svg"), svg);

async function coloredLayer(mask, color) {
	return sharp({
		create: { width: info.width, height: info.height, channels: 4, background: color },
	})
		.composite([{ input: mask, blend: "dest-in" }])
		.png()
		.toBuffer();
}

async function themedMark(boundary, signal = "#E06A3B") {
	const [boundaryLayer, signalLayer] = await Promise.all([
		coloredLayer(boundaryMask, boundary),
		coloredLayer(signalMask, signal),
	]);
	return sharp({
		create: { width: info.width, height: info.height, channels: 4, background: "#00000000" },
	})
		.composite([{ input: boundaryLayer }, { input: signalLayer }])
		.png()
		.toBuffer();
}

async function renderIcon(filename, size, { background, boundary, signal, scale }) {
	const markSize = Math.round(size * scale);
	const mark = await sharp(await themedMark(boundary, signal))
		.resize(markSize, markSize, { fit: "contain", background: "#00000000" })
		.png()
		.toBuffer();

	await sharp({
		create: { width: size, height: size, channels: 4, background },
	})
		.composite([{ input: mark, gravity: "centre" }])
		.png()
		.toFile(path.join(publicDir, filename));
}

const regular = { background: "#F6F8FB", boundary: "#0D1524", signal: "#E06A3B", scale: 0.76 };
const maskable = { background: "#0D1524", boundary: "#F6F8FB", signal: "#F07B4F", scale: 0.58 };

await Promise.all([
	renderIcon("icon-48.png", 48, regular),
	renderIcon("icon-96.png", 96, regular),
	renderIcon("icon-192.png", 192, regular),
	renderIcon("icon-512.png", 512, regular),
	renderIcon("apple-touch-icon.png", 180, regular),
	renderIcon("icon-maskable-192.png", 192, maskable),
	renderIcon("icon-maskable-512.png", 512, maskable),
	renderIcon("picket-icon-v1-48.png", 48, regular),
	renderIcon("picket-icon-v1-96.png", 96, regular),
	renderIcon("picket-icon-v1-192.png", 192, regular),
	renderIcon("picket-icon-v1-512.png", 512, regular),
	renderIcon("picket-apple-touch-icon-v1.png", 180, regular),
	renderIcon("picket-icon-maskable-v1-192.png", 192, maskable),
	renderIcon("picket-icon-maskable-v1-512.png", 512, maskable),
]);

const faviconPng = await sharp(await themedMark("#0D1524"))
	.resize(32, 32, { fit: "contain", background: "#00000000" })
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
const favicon = Buffer.concat([header, faviconPng]);
await Promise.all([
	writeFile(path.join(publicDir, "favicon.ico"), favicon),
	writeFile(path.join(publicDir, "picket-favicon-v1.ico"), favicon),
]);
