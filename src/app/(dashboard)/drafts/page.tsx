"use client";

import { MessageFolderPage } from "@/components/messages/message-folder-page";

export default function DraftsPage() {
	return (
		<MessageFolderPage
			config={{
				folder: "drafts",
				emptyText: "No drafts",
				hrefPrefix: "/drafts",
				badgeVariant: "outline",
			}}
		/>
	);
}
