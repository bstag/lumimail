"use client";

import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import { useTranslations } from "next-intl";
import {
	AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, Code2, Heading1,
	Heading2, Highlighter, ImagePlus, Italic, Link, List, ListOrdered, Minus,
	MoreHorizontal, Pilcrow, Quote, Redo2, RemoveFormatting, Strikethrough, Subscript,
	Superscript, Table2, Trash2, Underline, Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type CommandButton = {
	key: string;
	label: string;
	group: "history" | "structure" | "format" | "align" | "insert";
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
	onRemoveInlineImage,
}: {
	editor: Editor | null;
	onInsertImage?: () => void;
	onRemoveInlineImage?: (contentId: string) => void;
}) {
	const t = useTranslations("compose.toolbar");
	const [linkOpen, setLinkOpen] = useState(false);
	const [linkUrl, setLinkUrl] = useState("");
	const [imageAlt, setImageAlt] = useState("");
	const [, setEditorRevision] = useState(0);

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
		const refresh = () => {
			setEditorRevision((revision) => revision + 1);
			if (editor.isActive("image")) {
				setImageAlt((editor.getAttributes("image").alt as string | undefined) ?? "");
			}
		};
		editor.on("selectionUpdate", refresh);
		editor.on("transaction", refresh);
		return () => {
			editor.view.dom.removeEventListener("keydown", onKeyDown);
			editor.off("selectionUpdate", refresh);
			editor.off("transaction", refresh);
		};
	}, [editor]);

	if (!editor) return <div className="h-9 border-b border-border" />;

	const commands: CommandButton[] = [
		{ key: "undo", label: t("undo"), group: "history", icon: Undo2, run: (ed) => ed.chain().focus().undo().run(), enabled: (ed) => ed.can().undo() },
		{ key: "redo", label: t("redo"), group: "history", icon: Redo2, run: (ed) => ed.chain().focus().redo().run(), enabled: (ed) => ed.can().redo() },
		{ key: "paragraph", label: t("normalText"), group: "structure", icon: Pilcrow, run: (ed) => ed.chain().focus().setParagraph().run(), active: (ed) => ed.isActive("paragraph") },
		{ key: "clear", label: t("clearFormatting"), group: "structure", icon: RemoveFormatting, run: (ed) => ed.chain().focus().unsetAllMarks().clearNodes().run() },
		{ key: "bold", label: t("bold"), group: "format", icon: Bold, run: (ed) => ed.chain().focus().toggleBold().run(), active: (ed) => ed.isActive("bold") },
		{ key: "italic", label: t("italic"), group: "format", icon: Italic, run: (ed) => ed.chain().focus().toggleItalic().run(), active: (ed) => ed.isActive("italic") },
		{ key: "underline", label: t("underline"), group: "format", icon: Underline, run: (ed) => ed.chain().focus().toggleUnderline().run(), active: (ed) => ed.isActive("underline") },
		{ key: "strike", label: t("strikethrough"), group: "format", icon: Strikethrough, run: (ed) => ed.chain().focus().toggleStrike().run(), active: (ed) => ed.isActive("strike") },
		{ key: "sup", label: t("superscript"), group: "format", icon: Superscript, run: (ed) => ed.chain().focus().toggleSuperscript().run(), active: (ed) => ed.isActive("superscript") },
		{ key: "sub", label: t("subscript"), group: "format", icon: Subscript, run: (ed) => ed.chain().focus().toggleSubscript().run(), active: (ed) => ed.isActive("subscript") },
		{ key: "h1", label: t("heading1"), group: "structure", icon: Heading1, run: (ed) => ed.chain().focus().toggleHeading({ level: 1 }).run(), active: (ed) => ed.isActive("heading", { level: 1 }) },
		{ key: "h2", label: t("heading2"), group: "structure", icon: Heading2, run: (ed) => ed.chain().focus().toggleHeading({ level: 2 }).run(), active: (ed) => ed.isActive("heading", { level: 2 }) },
		{ key: "bullet", label: t("bulletList"), group: "structure", icon: List, run: (ed) => ed.chain().focus().toggleBulletList().run(), active: (ed) => ed.isActive("bulletList") },
		{ key: "ordered", label: t("orderedList"), group: "structure", icon: ListOrdered, run: (ed) => ed.chain().focus().toggleOrderedList().run(), active: (ed) => ed.isActive("orderedList") },
		{ key: "quote", label: t("blockquote"), group: "structure", icon: Quote, run: (ed) => ed.chain().focus().toggleBlockquote().run(), active: (ed) => ed.isActive("blockquote") },
		{ key: "code", label: t("inlineCode"), group: "format", icon: Code2, run: (ed) => ed.chain().focus().toggleCode().run(), active: (ed) => ed.isActive("code") },
		{ key: "codeblock", label: t("codeBlock"), group: "structure", icon: Code2, run: (ed) => ed.chain().focus().toggleCodeBlock().run(), active: (ed) => ed.isActive("codeBlock") },
		{ key: "rule", label: t("horizontalRule"), group: "insert", icon: Minus, run: (ed) => ed.chain().focus().setHorizontalRule().run() },
		...([
			["left", t("alignLeft"), AlignLeft],
			["center", t("alignCenter"), AlignCenter],
			["right", t("alignRight"), AlignRight],
			["justify", t("justify"), AlignJustify],
		] as const).map(([alignment, label, icon]) => ({
			key: `align-${alignment}`, label, group: "align" as const, icon,
			run: (ed: Editor) => ed.chain().focus().setTextAlign(alignment).run(),
			active: (ed: Editor) => ed.isActive({ textAlign: alignment }),
		})),
		{ key: "table", label: t("insertTable"), group: "insert", icon: Table2, run: (ed) => ed.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
		{ key: "delete-table", label: t("deleteTable"), group: "insert", icon: Trash2, run: (ed) => ed.chain().focus().deleteTable().run(), enabled: (ed) => ed.can().deleteTable() },
	];
	const primaryKeys = new Set(["undo", "redo", "paragraph", "bold", "italic", "underline"]);
	const primaryCommands = commands.filter((command) => primaryKeys.has(command.key));
	const secondaryCommands = commands.filter((command) => !primaryKeys.has(command.key));

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
		<div className="relative border-b border-border px-2 py-1" role="toolbar" aria-label={t("messageFormatting")}>
			<div className="flex items-center gap-0.5 overflow-x-auto">
				{primaryCommands.map((command) => <EditorButton key={command.key} editor={editor} command={command} />)}
				<div className="hidden min-w-0 flex-wrap items-center gap-0.5 sm:flex">
					{secondaryCommands.map((command, index) => (
						<span key={command.key} className="contents">
							{index > 0 && secondaryCommands[index - 1]?.group !== command.group && (
								<span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
							)}
							<EditorButton editor={editor} command={command} />
						</span>
					))}
				</div>
				<details className="relative sm:hidden">
					<summary className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-md hover:bg-surface-subtle" aria-label={t("moreFormatting")}>
						<MoreHorizontal className="h-4 w-4" />
					</summary>
					<div className="absolute left-0 top-9 z-20 grid w-56 grid-cols-6 gap-0.5 rounded-md border border-border bg-surface-raised p-2 shadow-lg">
						{secondaryCommands.map((command) => <EditorButton key={command.key} editor={editor} command={command} />)}
					</div>
				</details>
				<Button
					type="button" variant="ghost" size="sm" className="h-8 w-8 px-0"
					onClick={() => {
						setLinkUrl((editor.getAttributes("link").href as string | undefined) ?? "");
						setLinkOpen((open) => !open);
					}}
					aria-label={t("editLink")} title={`${t("editLink")} (Ctrl/⌘ K)`}
					aria-pressed={editor.isActive("link")}
				>
					<Link className="h-4 w-4" />
				</Button>
				<label className="flex h-8 w-8 cursor-pointer items-center justify-center" title={t("textColor")}>
					<span className="sr-only">{t("textColor")}</span>
					<input
						type="color" className="h-5 w-5 cursor-pointer border-0 bg-transparent p-0"
						value={(editor.getAttributes("textStyle").color as string | undefined)?.match(/^#[\da-f]{6}$/i)?.[0] ?? "#000000"}
						onChange={(event) => editor.chain().focus().setColor(event.target.value).run()}
					/>
				</label>
				<Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => editor.chain().focus().unsetColor().run()} disabled={!editor.getAttributes("textStyle").color}>
					{t("clearTextColor")}
				</Button>
				<label className="relative flex h-8 w-8 cursor-pointer items-center justify-center" title={t("highlightColor")}>
					<Highlighter className="pointer-events-none absolute h-4 w-4" />
					<span className="sr-only">{t("highlightColor")}</span>
					<input
						type="color" className="h-8 w-8 cursor-pointer opacity-0"
						onChange={(event) => editor.chain().focus().setHighlight({ color: event.target.value }).run()}
					/>
				</label>
				<Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => editor.chain().focus().unsetHighlight().run()} disabled={!editor.isActive("highlight")}>
					{t("clearHighlight")}
				</Button>
				{onInsertImage && (
					<Button type="button" variant="ghost" size="sm" className="h-8 w-8 px-0" onClick={onInsertImage} aria-label={t("insertImage")} title={t("insertImage")}>
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
						aria-label={t("linkUrl")}
						autoFocus
					/>
					<Button type="button" size="sm" onClick={applyLink}>{t("apply")}</Button>
					<Button type="button" size="sm" variant="ghost" onClick={() => {
						editor.chain().focus().extendMarkRange("link").unsetLink().run();
						setLinkOpen(false);
					}}>{t("remove")}</Button>
				</div>
			)}
			{editor.isActive("image") && (
				<div className="mt-1 flex items-center gap-2 rounded-md bg-surface-subtle p-2">
					<Input value={imageAlt} onChange={(event) => setImageAlt(event.target.value)} aria-label={t("imageAltText")} placeholder={t("imageAltPlaceholder")} />
					<Button type="button" size="sm" onClick={() => editor.chain().focus().updateAttributes("image", { alt: imageAlt.trim() }).run()}>
						{t("apply")}
					</Button>
					<Button type="button" size="sm" variant="ghost" onClick={() => {
						const src = editor.getAttributes("image").src as string | undefined;
						editor.chain().focus().deleteSelection().run();
						if (src?.startsWith("cid:")) onRemoveInlineImage?.(src.slice(4));
					}}>
						{t("removeImage")}
					</Button>
				</div>
			)}
			{editor.isActive("table") && (
				<div className="mt-1 flex flex-wrap gap-1" aria-label={t("tableControls")}>
					<Button type="button" size="sm" variant="ghost" onClick={() => editor.chain().focus().addRowAfter().run()}>{t("addRow")}</Button>
					<Button type="button" size="sm" variant="ghost" onClick={() => editor.chain().focus().addColumnAfter().run()}>{t("addColumn")}</Button>
					<Button type="button" size="sm" variant="ghost" onClick={() => editor.chain().focus().deleteRow().run()}>{t("deleteRow")}</Button>
					<Button type="button" size="sm" variant="ghost" onClick={() => editor.chain().focus().deleteColumn().run()}>{t("deleteColumn")}</Button>
					<Button type="button" size="sm" variant="ghost" onClick={() => editor.chain().focus().mergeOrSplit().run()}>{t("mergeSplit")}</Button>
				</div>
			)}
		</div>
	);
}
