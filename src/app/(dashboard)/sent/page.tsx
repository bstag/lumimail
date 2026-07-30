"use client";

import { Send } from "lucide-react";
import { MessageFolderPage } from "@/components/messages/message-folder-page";

export default function SentPage() {
	return (
		<MessageFolderPage
			config={{
				folder: "sent",
				emptyText: "No emails",
				hrefPrefix: "/sent",
				icon: Send,
				badgeVariant: "outline",
			}}
		/>
	);
}
