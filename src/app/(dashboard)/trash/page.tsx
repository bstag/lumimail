'use client'

import { MessageFolderPage } from "@/components/messages/message-folder-page";

export default function TrashPage() {
	return (
		<MessageFolderPage
			config={{
				folder: "trash",
				emptyText: "No emails in trash",
				hrefPrefix: "/trash",
				badgeVariant: "outline",
			}}
		/>
	);
}
