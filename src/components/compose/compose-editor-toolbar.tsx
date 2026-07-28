"use client";

import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import {
	AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, Code2, Heading1,
	Heading2, Highlighter, ImagePlus, Italic, Link, List, ListOrdered, Minus,
	Pilcrow, Quote, Redo2, RemoveFormatting, Strikethrough, Subscript,
	Superscript, Table2, Trash2, Underline, Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type CommandButton = {
	key: string;
	label: string;
	icon: React.ComponentType<{ className?: string }>;
	run: (editor: Editor) => boolean;
	active?: (editor: Editor) => boolean;
	enabled?: (editor: Editor) => boolean;
};

function EditorButton({ editor, command }: { editor: Editor; command: CommandButton }) {
	const active = command.active?.(editor) ?? false;
	const enabled = command.enabled?.(editor) ?? true;
	return (
		<Button
			type="button"
			variant="ghost"
			size="sm"
			className={cn("h-8 w-8 px-0", active && "bg-surface-subtle text-accent")}
			onClick={() => command.run(editor)}
			disabled={!enabled}
			title={command.label}
			aria-label={command.label}
			aria-pressed={command.active ? active : undefined}
		>
			<command.icon className="h-4 w-4" />
		</Button>
	);
}

export function ComposeEditorToolbar({
	editor,
	onInsertImage,
}: {
	editor: Editor | null;
	onInsertImage?: () => void;
}) {
	const [linkOpen, setLinkOpen] = useState(false);
	const [linkUrl, setLinkUrl] = useState("");

	useEffect(() => {
		if (!editor) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
				event.preventDefault();
				setLinkUrl((editor.getAttributes("link").href as string | undefined) ?? "");
				setLinkOpen(true);
			}
		};
		editor.view.dom.addEventListener("keydown", onKeyDown);
		return () => editor.view.dom.removeEventListener("keydown", onKeyDown);
	}, [editor]);

	if (!editor) return <div className="h-9 border-b border-border" />;

	const commands: CommandButton[] = [
		{ key: "undo", label: "Undo", icon: Undo2, run: (ed) => ed.chain().focus().undo().run(), enabled: (ed) => ed.can().undo() },
		{ key: "redo", label: "Redo", icon: Redo2, run: (ed) => ed.chain().focus().redo().run(), enabled: (ed) => ed.can().redo() },
		{ key: "paragraph", label: "Normal text", icon: Pilcrow, run: (ed) => ed.chain().focus().setParagraph().run(), active: (ed) => ed.isActive("paragraph") },
		{ key: "clear", label: "Clear formatting", icon: RemoveFormatting, run: (ed) => ed.chain().focus().unsetAllMarks().clearNodes().run() },
		{ key: "bold", label: "Bold", icon: Bold, run: (ed) => ed.chain().focus().toggleBold().run(), active: (ed) => ed.isActive("bold") },
		{ key: "italic", label: "Italic", icon: Italic, run: (ed) => ed.chain().focus().toggleItalic().run(), active: (ed) => ed.isActive("italic") },
		{ key: "underline", label: "Underline", icon: Underline, run: (ed) => ed.chain().focus().toggleUnderline().run(), active: (ed) => ed.isActive("underline") },
		{ key: "strike", label: "Strikethrough", icon: Strikethrough, run: (ed) => ed.chain().focus().toggleStrike().run(), active: (ed) => ed.isActive("strike") },
		{ key: "sup", label: "Superscript", icon: Superscript, run: (ed) => ed.chain().focus().toggleSuperscript().run(), active: (ed) => ed.isActive("superscript") },
		{ key: "sub", label: "Subscript", icon: Subscript, run: (ed) => ed.chain().focus().toggleSubscript().run(), active: (ed) => ed.isActive("subscript") },
		{ key: "h1", label: "Heading 1", icon: Heading1, run: (ed) => ed.chain().focus().toggleHeading({ level: 1 }).run(), active: (ed) => ed.isActive("heading", { level: 1 }) },
		{ key: "h2", label: "Heading 2", icon: Heading2, run: (ed) => ed.chain().focus().toggleHeading({ level: 2 }).run(), active: (ed) => ed.isActive("heading", { level: 2 }) },
		{ key: "bullet", label: "Bullet list", icon: List, run: (ed) => ed.chain().focus().toggleBulletList().run(), active: (ed) => ed.isActive("bulletList") },
		{ key: "ordered", label: "Numbered list", icon: ListOrdered, run: (ed) => ed.chain().focus().toggleOrderedList().run(), active: (ed) => ed.isActive("orderedList") },
		{ key: "quote", label: "Blockquote", icon: Quote, run: (ed) => ed.chain().focus().toggleBlockquote().run(), active: (ed) => ed.isActive("blockquote") },
		{ key: "code", label: "Inline code", icon: Code2, run: (ed) => ed.chain().focus().toggleCode().run(), active: (ed) => ed.isActive("code") },
		{ key: "codeblock", label: "Code block", icon: Code2, run: (ed) => ed.chain().focus().toggleCodeBlock().run(), active: (ed) => ed.isActive("codeBlock") },
		{ key: "rule", label: "Horizontal rule", icon: Minus, run: (ed) => ed.chain().focus().setHorizontalRule().run() },
		...([
			["left", "Align left", AlignLeft],
			["center", "Align center", AlignCenter],
			["right", "Align right", AlignRight],
			["justify", "Justify", AlignJustify],
		] as const).map(([alignment, label, icon]) => ({
			key: `align-${alignment}`, label, icon,
			run: (ed: Editor) => ed.chain().focus().setTextAlign(alignment).run(),
			active: (ed: Editor) => ed.isActive({ textAlign: alignment }),
		})),
		{ key: "table", label: "Insert table", icon: Table2, run: (ed) => ed.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
		{ key: "delete-table", label: "Delete table", icon: Trash2, run: (ed) => ed.chain().focus().deleteTable().run(), enabled: (ed) => ed.can().deleteTable() },
	];

	function applyLink() {
		const value = linkUrl.trim();
		if (!value) {
			editor!.chain().focus().extendMarkRange("link").unsetLink().run();
		} else {
			editor!.chain().focus().extendMarkRange("link").setLink({ href: value }).run();
		}
		setLinkOpen(false);
	}

	return (
		<div className="border-b border-border px-2 py-1" role="toolbar" aria-label="Message formatting">
			<div className="flex flex-wrap items-center gap-0.5">
				{commands.map((command) => <EditorButton key={command.key} editor={editor} command={command} />)}
				<Button
					type="button" variant="ghost" size="sm" className="h-8 w-8 px-0"
					onClick={() => {
						setLinkUrl((editor.getAttributes("link").href as string | undefined) ?? "");
						setLinkOpen((open) => !open);
					}}
					aria-label="Edit link" title="Edit link (Ctrl/⌘ K)"
					aria-pressed={editor.isActive("link")}
				>
					<Link className="h-4 w-4" />
				</Button>
				<label className="flex h-8 w-8 cursor-pointer items-center justify-center" title="Text color">
					<span className="sr-only">Text color</span>
					<input
						type="color" className="h-5 w-5 cursor-pointer border-0 bg-transparent p-0"
						onChange={(event) => editor.chain().focus().setColor(event.target.value).run()}
					/>
				</label>
				<label className="flex h-8 w-8 cursor-pointer items-center justify-center" title="Highlight color">
					<Highlighter className="pointer-events-none absolute h-4 w-4" />
					<span className="sr-only">Highlight color</span>
					<input
						type="color" className="h-8 w-8 cursor-pointer opacity-0"
						onChange={(event) => editor.chain().focus().setHighlight({ color: event.target.value }).run()}
					/>
				</label>
				{onInsertImage && (
					<Button type="button" variant="ghost" size="sm" className="h-8 w-8 px-0" onClick={onInsertImage} aria-label="Insert image" title="Insert image">
						<ImagePlus className="h-4 w-4" />
					</Button>
				)}
			</div>
			{linkOpen && (
				<div className="mt-1 flex items-center gap-2 rounded-md bg-surface-subtle p-2">
					<Input
						value={linkUrl}
						onChange={(event) => setLinkUrl(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter") { event.preventDefault(); applyLink(); }
							if (event.key === "Escape") setLinkOpen(false);
						}}
						placeholder="https://example.com"
						aria-label="Link URL"
						autoFocus
					/>
					<Button type="button" size="sm" onClick={applyLink}>Apply</Button>
					<Button type="button" size="sm" variant="ghost" onClick={() => {
						editor.chain().focus().extendMarkRange("link").unsetLink().run();
						setLinkOpen(false);
					}}>Remove</Button>
				</div>
			)}
			{editor.isActive("table") && (
				<div className="mt-1 flex flex-wrap gap-1" aria-label="Table controls">
					<Button type="button" size="sm" variant="ghost" onClick={() => editor.chain().focus().addRowAfter().run()}>Add row</Button>
					<Button type="button" size="sm" variant="ghost" onClick={() => editor.chain().focus().addColumnAfter().run()}>Add column</Button>
					<Button type="button" size="sm" variant="ghost" onClick={() => editor.chain().focus().deleteRow().run()}>Delete row</Button>
					<Button type="button" size="sm" variant="ghost" onClick={() => editor.chain().focus().deleteColumn().run()}>Delete column</Button>
					<Button type="button" size="sm" variant="ghost" onClick={() => editor.chain().focus().mergeOrSplit().run()}>Merge/split</Button>
				</div>
			)}
		</div>
	);
}
