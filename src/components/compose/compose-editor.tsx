"use client";

import { useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import { createComposeExtensions } from "./editor-extensions";

export type ComposeEditorProps = {
  content: string;
  label: string;
  onChange: (content: { html: string; text: string }) => void;
  disabled?: boolean;
  onEditorReady?: (editor: Editor | null) => void;
};

export function ComposeEditor({
  content,
  label,
  onChange,
  disabled = false,
  onEditorReady,
}: ComposeEditorProps) {
  const editor = useEditor(
    {
      extensions: createComposeExtensions(),
      content,
      immediatelyRender: false,
      editable: !disabled,
      editorProps: {
        attributes: {
          class: "tiptap min-h-full px-4 py-3 text-sm text-ink focus:outline-none",
          role: "textbox",
          "aria-label": label,
        },
      },
      onUpdate: ({ editor }) => {
        onChange({
          html: editor.getHTML(),
          text: editor.getText({ blockSeparator: "\n" }),
        });
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
