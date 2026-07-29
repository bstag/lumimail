import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createTranslator } from "use-intl/core";

describe("localized compose messages", () => {
	const toolbarKeys = [
		"undo", "redo", "normalText", "clearFormatting", "bold", "italic",
		"underline", "strikethrough", "superscript", "subscript", "heading1",
		"heading2", "bulletList", "orderedList", "blockquote", "inlineCode",
		"codeBlock", "horizontalRule", "alignLeft", "alignCenter", "alignRight",
		"justify", "insertTable", "deleteTable", "messageFormatting",
		"moreFormatting", "editLink", "textColor", "clearTextColor",
		"highlightColor", "clearHighlight", "insertImage", "linkUrl", "apply",
		"remove", "imageAltText", "imageAltPlaceholder", "removeImage",
		"tableControls", "addRow", "addColumn", "deleteRow", "deleteColumn",
		"mergeSplit",
	] as const;

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
			for (const key of toolbarKeys) {
				expect(translator(`compose.toolbar.${key}`), `${filename}: ${key}`).not.toBe("");
			}
			expect(errors, filename).toEqual([]);
		}
	});
});
