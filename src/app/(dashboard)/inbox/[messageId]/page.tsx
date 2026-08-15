"use client";

import { useParams } from "next/navigation";
import { MessageDetailView } from "@/components/messages/message-detail-view";

export default function MessageDetailPage() {
	const { messageId } = useParams<{ messageId: string }>();
	return <MessageDetailView messageId={messageId} />;
}
