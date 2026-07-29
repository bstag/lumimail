// @vitest-environment jsdom

import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { createComposeExtensions } from "@/components/compose/editor-extensions";

describe("createComposeExtensions", () => {
	it("supports the expanded formatting schema", () => {
		const editor = new Editor({
			extensions: createComposeExtensions(),
			content: "<p>Example</p>",
		});
		editor.commands.selectAll();
		editor.chain()
			.setColor("#2563eb")
			.setBackgroundColor("#fef08a")
			.setTextAlign("center")
			.setSuperscript()
			.run();

		expect(editor.getHTML()).toContain('style="text-align: center;"');
		expect(editor.getHTML()).toContain("color: rgb(37, 99, 235)");
		expect(editor.getHTML()).toContain("background-color: rgb(254, 240, 138)");
		expect(editor.getHTML()).toContain("<sup>");
		editor.destroy();
	});

	it("supports tables, images, rules, code blocks, and history", () => {
		const editor = new Editor({ extensions: createComposeExtensions() });
		expect(editor.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true })).toBe(true);
		expect(editor.getHTML()).toContain("<table");
		expect(editor.commands.undo()).toBe(true);
		expect(editor.commands.setImage({
			src: "cid:inline-test",
			alt: "Uploaded image",
		})).toBe(true);
		expect(editor.getHTML()).toContain('src="cid:inline-test"');
		editor.commands.updateAttributes("image", { alt: "Quarterly chart" });
		expect(editor.getHTML()).toContain('alt="Quarterly chart"');
		editor.commands.setHorizontalRule();
		expect(editor.getHTML()).toContain("<hr>");
		editor.commands.setCodeBlock();
		expect(editor.getHTML()).toContain("<pre>");
		editor.destroy();
	});
});
