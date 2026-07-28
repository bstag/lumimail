"use client";

import { useEffect } from "react";
import { notifyMessagesChanged } from "@/hooks/utils";
import { authFetch } from "@/lib/auth/client";

export function MarkAsRead({
	messageId,
	onMarkedRead,
}: {
	messageId: string;
	onMarkedRead?: () => void;
}) {
	useEffect(() => {
		authFetch(`/api/messages/${messageId}/read`, { method: "POST" })
			.then((response) => {
				if (response.ok) {
					onMarkedRead?.();
					notifyMessagesChanged();
				}
			})
			.catch(() => {
				if (process.env.NODE_ENV !== "production") {
					console.error("Failed to mark message as read:", messageId);
				}
			});
	}, [messageId, onMarkedRead]);

	return null;
}
