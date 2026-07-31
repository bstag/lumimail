"use client";

import { MessageFolderPage } from "@/components/messages/message-folder-page";

export default function SentPage() {
	return (
		<MessageFolderPage
			config={{
				folder: "sent",
				emptyText: "No emails",
				hrefPrefix: "/sent",
				badgeVariant: "outline",
			}}
		/>
	);
}
