import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
// Operational script, deliberately outside src/ so it is not bundled into the Worker.
import { extractR2Keys, keyToPath, verifyBackup } from "../../../scripts/r2-backup.mjs";

const temporary: string[] = [];

afterEach(() => {
	for (const directory of temporary) rmSync(directory, { recursive: true, force: true });
	temporary.length = 0;
});

function makeBackup(objects: { key: string; content: string; corrupt?: boolean; omit?: boolean }[]) {
	const directory = mkdtempSync(join(tmpdir(), "lumimail-r2-backup-"));
	temporary.push(directory);

	const manifest = objects.map((object) => {
		const path = keyToPath(directory, object.key) as string;
		if (!object.omit) {
			mkdirSync(join(path, ".."), { recursive: true });
			writeFileSync(path, object.corrupt ? `${object.content}tampered` : object.content);
		}
		return {
			key: object.key,
			size: object.content.length,
			sha256: createHash("sha256").update(object.content).digest("hex"),
		};
	});

	writeFileSync(join(directory, "manifest.json"), JSON.stringify({ objects: manifest }));
	return directory;
}

describe("extractR2Keys", () => {
	it("finds attachment and raw inbound keys in a dump", () => {
		const dump = `
INSERT INTO attachments VALUES('att_1','msg_1','a.txt','text/plain',9,'attachments/u1/msg_1/att_1',1784);
INSERT INTO message_bodies VALUES('b1','msg_1','text',NULL,'inbound/1784-abc.eml');
`;

		expect(extractR2Keys(dump)).toEqual([
			"attachments/u1/msg_1/att_1",
			"inbound/1784-abc.eml",
		]);
	});

	it("deduplicates a key referenced more than once", () => {
		const dump = `
INSERT INTO a VALUES('attachments/u1/m/x');
INSERT INTO b VALUES('attachments/u1/m/x');
`;

		expect(extractR2Keys(dump)).toEqual(["attachments/u1/m/x"]);
	});

	it("ignores values that are not object keys", () => {
		// Column order must not matter, and unrelated strings must not be fetched.
		const dump = `INSERT INTO messages VALUES('msg_1','someone@example.com','Subject with attachments/ word');`;

		expect(extractR2Keys(dump)).toEqual([]);
	});

	it("returns nothing for a database with no objects", () => {
		expect(extractR2Keys("INSERT INTO users VALUES('u1','a@b.c');")).toEqual([]);
	});
});

describe("verifyBackup", () => {
	it("accepts a backup whose files match the manifest", () => {
		const directory = makeBackup([
			{ key: "attachments/u1/m1/a1", content: "hello" },
			{ key: "inbound/1-x.eml", content: "raw mime" },
		]);

		expect(verifyBackup(directory)).toEqual({ checked: 2, problems: [] });
	});

	it("reports a file whose bytes were altered", () => {
		const directory = makeBackup([{ key: "attachments/u1/m1/a1", content: "hello", corrupt: true }]);

		const result = verifyBackup(directory) as { problems: string[] };
		// Size differs too, so both checks fire; the point is that it is caught.
		expect(result.problems.join(" ")).toContain("attachments/u1/m1/a1");
	});

	it("reports a file missing from the backup entirely", () => {
		const directory = makeBackup([{ key: "attachments/u1/m1/a1", content: "hello", omit: true }]);

		expect((verifyBackup(directory) as { problems: string[] }).problems).toEqual([
			"attachments/u1/m1/a1: file missing from backup",
		]);
	});
});
