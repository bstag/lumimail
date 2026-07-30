"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { invalidateMessageQueries } from "@/lib/query-keys";
import { authFetch } from "@/lib/auth/client";

export function MarkAsRead({
	messageId,
	onMarkedRead,
}: {
	messageId: string;
	onMarkedRead?: () => void;
}) {
	const queryClient = useQueryClient();

	useEffect(() => {
		authFetch(`/api/messages/${messageId}/read`, { method: "POST" })
			.then((response) => {
				if (response.ok) {
					onMarkedRead?.();
					void invalidateMessageQueries(queryClient);
				}
			})
			.catch(() => {
				if (process.env.NODE_ENV !== "production") {
					console.error("Failed to mark message as read:", messageId);
				}
			});
	}, [messageId, onMarkedRead, queryClient]);

	return null;
}
