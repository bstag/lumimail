'use client'

import { MessageFolderPage } from "@/components/messages/message-folder-page";

export default function SpamPage() {
	return (
		<MessageFolderPage
			config={{
				folder: "spam",
				emptyText: "No spam",
				hrefPrefix: "/spam",
				badgeVariant: "outline",
			}}
		/>
	);
}
