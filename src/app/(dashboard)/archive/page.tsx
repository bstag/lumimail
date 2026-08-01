"use client";

import { MessageFolderPage } from "@/components/messages/message-folder-page";

export default function ArchivePage() {
	return (
		<MessageFolderPage
			config={{
				folder: "archived",
				emptyText: "No archived emails",
				// Archive holds both directions, and the detail route is shared, so
				// rows link through /inbox like Starred does.
				hrefPrefix: "/inbox",
				badgeVariant: "outline",
			}}
		/>
	);
}
