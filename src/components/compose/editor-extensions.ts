import Highlight from "@tiptap/extension-highlight";
import Image from "@tiptap/extension-image";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import { TableKit } from "@tiptap/extension-table";
import { TextStyleKit } from "@tiptap/extension-text-style";
import TextAlign from "@tiptap/extension-text-align";
import Typography from "@tiptap/extension-typography";
import StarterKit from "@tiptap/starter-kit";

export function createComposeExtensions() {
	return [
		StarterKit.configure({
			heading: { levels: [1, 2] },
			link: {
				openOnClick: false,
				defaultProtocol: "https",
			},
		}),
		TextAlign.configure({ types: ["heading", "paragraph"] }),
		TextStyleKit.configure({
			fontFamily: false,
			fontSize: false,
			lineHeight: false,
		}),
		Highlight.configure({ multicolor: true }),
		Superscript,
		Subscript,
		Typography,
		TableKit.configure({
			table: { resizable: false },
		}),
		Image.configure({
			allowBase64: false,
			inline: false,
		}),
	];
}
