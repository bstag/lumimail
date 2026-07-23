"use client";

import type { Editor } from "@tiptap/react";
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Heading1,
  Heading2,
  List,
  ListOrdered,
  Quote,
  Link,
  AlignLeft,
  AlignCenter,
  AlignRight,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ToolbarButton = {
  key: string;
  icon: React.ComponentType<{ className?: string }>;
  action: (editor: Editor) => boolean;
  isActive: (editor: Editor) => boolean;
  label: string;
};

function buildButtons(editor: Editor | null, labels: Record<string, string>): ToolbarButton[] {
  if (!editor) return [];
  return [
    {
      key: "bold",
      icon: Bold,
      action: (ed) => ed.chain().focus().toggleBold().run(),
      isActive: (ed) => ed.isActive("bold"),
      label: labels.bold,
    },
    {
      key: "italic",
      icon: Italic,
      action: (ed) => ed.chain().focus().toggleItalic().run(),
      isActive: (ed) => ed.isActive("italic"),
      label: labels.italic,
    },
    {
      key: "underline",
      icon: Underline,
      action: (ed) => ed.chain().focus().toggleUnderline().run(),
      isActive: (ed) => ed.isActive("underline"),
      label: labels.underline,
    },
    {
      key: "strikethrough",
      icon: Strikethrough,
      action: (ed) => ed.chain().focus().toggleStrike().run(),
      isActive: (ed) => ed.isActive("strike"),
      label: labels.strikethrough,
    },
    {
      key: "heading1",
      icon: Heading1,
      action: (ed) => ed.chain().focus().toggleHeading({ level: 1 }).run(),
      isActive: (ed) => ed.isActive("heading", { level: 1 }),
      label: labels.heading1,
    },
    {
      key: "heading2",
      icon: Heading2,
      action: (ed) => ed.chain().focus().toggleHeading({ level: 2 }).run(),
      isActive: (ed) => ed.isActive("heading", { level: 2 }),
      label: labels.heading2,
    },
    {
      key: "bulletList",
      icon: List,
      action: (ed) => ed.chain().focus().toggleBulletList().run(),
      isActive: (ed) => ed.isActive("bulletList"),
      label: labels.bulletList,
    },
    {
      key: "orderedList",
      icon: ListOrdered,
      action: (ed) => ed.chain().focus().toggleOrderedList().run(),
      isActive: (ed) => ed.isActive("orderedList"),
      label: labels.orderedList,
    },
    {
      key: "blockquote",
      icon: Quote,
      action: (ed) => ed.chain().focus().toggleBlockquote().run(),
      isActive: (ed) => ed.isActive("blockquote"),
      label: labels.blockquote,
    },
    {
      key: "link",
      icon: Link,
      action: (ed) => {
        const previousUrl = ed.getAttributes("link").href as string | undefined;
        if (previousUrl) {
          ed.chain().focus().extendMarkRange("link").unsetLink().run();
          return true;
        }
        const url = window.prompt("URL");
        if (!url) return false;
        ed.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
        return true;
      },
      isActive: (ed) => ed.isActive("link"),
      label: labels.link,
    },
    {
      key: "alignLeft",
      icon: AlignLeft,
      action: (ed) => ed.chain().focus().setTextAlign("left").run(),
      isActive: (ed) => ed.isActive({ textAlign: "left" }),
      label: labels.alignLeft,
    },
    {
      key: "alignCenter",
      icon: AlignCenter,
      action: (ed) => ed.chain().focus().setTextAlign("center").run(),
      isActive: (ed) => ed.isActive({ textAlign: "center" }),
      label: labels.alignCenter,
    },
    {
      key: "alignRight",
      icon: AlignRight,
      action: (ed) => ed.chain().focus().setTextAlign("right").run(),
      isActive: (ed) => ed.isActive({ textAlign: "right" }),
      label: labels.alignRight,
    },
  ];
}

export function ComposeEditorToolbar({ editor }: { editor: Editor | null }) {
  const t = useTranslations("compose.toolbar");
  const labels: Record<string, string> = {
    bold: t("bold"),
    italic: t("italic"),
    underline: t("underline"),
    strikethrough: t("strikethrough"),
    heading1: t("heading1"),
    heading2: t("heading2"),
    bulletList: t("bulletList"),
    orderedList: t("orderedList"),
    blockquote: t("blockquote"),
    link: t("link"),
    alignLeft: t("alignLeft"),
    alignCenter: t("alignCenter"),
    alignRight: t("alignRight"),
  };

  const buttons = buildButtons(editor, labels);

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-border px-2 py-0.5">
      {buttons.map((btn) => (
        <Button
          key={btn.key}
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            "h-8 w-8 px-0",
            "h-8 w-8",
            editor && btn.isActive(editor) && "bg-[var(--surface-subtle)] text-[var(--accent)]",
          )}
          onClick={() => editor && btn.action(editor)}
          title={btn.label}
          aria-label={btn.label}
        >
          <btn.icon className="h-4 w-4" />
        </Button>
      ))}
    </div>
  );
}
