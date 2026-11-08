"use client";

import { MessageFolderPage } from "@/components/messages/message-folder-page";

export default function SnoozedPage() {
	return (
		<MessageFolderPage
			config={{
				folder: "snoozed",
				emptyText: "No snoozed emails",
				hrefPrefix: "/inbox",
				showRowBadge: false,
			}}
		/>
	);
}
