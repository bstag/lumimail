"use client";

import { Star } from "lucide-react";
import { MessageFolderPage } from "@/components/messages/message-folder-page";

export default function StarredPage() {
	return (
		<MessageFolderPage
			config={{
				folder: "starred",
				emptyText: "No starred emails",
				hrefPrefix: "/inbox",
				icon: Star,
				showRowBadge: false,
			}}
		/>
	);
}
