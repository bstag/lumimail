"use client";

import { Star } from "lucide-react";
import { MessageFolderPage } from "@/components/messages/message-folder-page";

export default function InboxPage() {
	return (
		<MessageFolderPage
			config={{
				folder: "inbox",
				emptyText: "No emails",
				hrefPrefix: "/inbox",
				icon: Star,
				showRowBadge: false,
			}}
		/>
	);
}
