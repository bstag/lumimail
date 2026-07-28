"use client";

import { useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";

export type ComposeEditorProps = {
  content: string;
  onChange: (html: string) => void;
  disabled?: boolean;
  onEditorReady?: (editor: Editor | null) => void;
};

export function ComposeEditor({
  content,
  onChange,
  disabled = false,
  onEditorReady,
}: ComposeEditorProps) {
  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2] },
        }),
        Link.configure({
          openOnClick: false,
        }),
        Underline,
        TextAlign.configure({
          types: ["heading", "paragraph"],
        }),
      ],
      content,
      editable: !disabled,
      editorProps: {
        attributes: {
          class: "tiptap prose prose-sm max-w-none focus:outline-none",
          role: "textbox",
        },
      },
      onUpdate: ({ editor }) => {
        onChange(editor.getHTML());
      },
    },
    [],
  );

  useEffect(() => {
    if (!editor) return;
    const isSame = editor.getHTML() === content;
    if (isSame) return;
    editor.commands.setContent(content, { emitUpdate: false });
  }, [editor, content]);

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  useEffect(() => {
    onEditorReady?.(editor);
  }, [editor, onEditorReady]);

  return <EditorContent editor={editor} />;
}
