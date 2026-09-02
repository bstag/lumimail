import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = path.join(root, "mantle", "sigils", "primary-sigil-transparent.png");
const reference = path.join(root, "mantle", "derived", "primary-mark-reference.png");
const boundaryMask = path.join(root, "public", "brand", "picket-mark-boundary-mask.png");
const signalMask = path.join(root, "public", "brand", "picket-mark-signal-mask.png");

async function raw(file: string) {
	return sharp(readFileSync(file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}

describe("Mantle sigil fidelity", () => {
	it("preserves the exact supplied primary-mark crop as its visual oracle", async () => {
		const expected = await sharp(source)
			.extract({ left: 102, top: 344, width: 290, height: 336 })
			.ensureAlpha()
			.raw()
			.toBuffer();
		const actual = await sharp(reference).ensureAlpha().raw().toBuffer();

		expect(actual.equals(expected)).toBe(true);
	});

	it("splits the source alpha into aligned, lossless boundary and signal masks", async () => {
		const [oracle, boundary, signal] = await Promise.all([
			raw(reference),
			raw(boundaryMask),
			raw(signalMask),
		]);

		expect(boundary.info).toMatchObject({ width: 290, height: 336, channels: 4 });
		expect(signal.info).toMatchObject({ width: 290, height: 336, channels: 4 });

		for (let pixel = 0; pixel < oracle.info.width * oracle.info.height; pixel += 1) {
			const alpha = oracle.data[pixel * 4 + 3];
			const boundaryAlpha = boundary.data[pixel * 4 + 3];
			const signalAlpha = signal.data[pixel * 4 + 3];
			expect(Math.max(boundaryAlpha, signalAlpha)).toBe(alpha);
			expect(Math.min(boundaryAlpha, signalAlpha)).toBe(0);
		}
	});
});
