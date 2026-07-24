import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createTranslator } from "use-intl/core";

describe("localized compose messages", () => {
	it("formats the recipient placeholder in every supported locale without ICU errors", () => {
		const directory = resolve(process.cwd(), "src/i18n/messages");
		for (const filename of readdirSync(directory).filter((name) => name.endsWith(".json"))) {
			const locale = filename.replace(/\.json$/, "");
			const messages = JSON.parse(readFileSync(resolve(directory, filename), "utf8"));
			const errors: unknown[] = [];
			const translator = createTranslator({
				locale,
				messages,
				onError: (error) => errors.push(error),
			});

			expect(translator("compose.recipientsPlaceholder"), filename).toContain("@");
			expect(errors, filename).toEqual([]);
		}
	});
});
