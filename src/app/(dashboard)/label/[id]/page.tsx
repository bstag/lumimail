"use client";

import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { MessageFolderPage } from "@/components/messages/message-folder-page";
import { apiJson } from "@/lib/api/client-response";
import { labelKeys } from "@/lib/query-keys";
import type { LabelRecord } from "@/lib/labels-tree";

async function fetchLabels(): Promise<LabelRecord[]> {
	const data = await apiJson.get<unknown>("/api/labels");
	return Array.isArray(data) ? (data as LabelRecord[]) : [];
}

export default function LabelPage({ params }: { params: Promise<{ id: string }> }) {
	const { id } = use(params);
	const { data: labels = [] } = useQuery({ queryKey: labelKeys.all, queryFn: fetchLabels });
	// A label id that resolves to nothing — deleted, or another user's — falls
	// through to the empty state rather than erroring: the messages query is
	// already scoped by `messageAccessCondition`, so it returns no rows either way.
	const label = labels.find((candidate) => candidate.id === id);

	return (
		<MessageFolderPage
			config={{
				folder: "label",
				labelId: id,
				title: label?.name,
				emptyText: "No messages with this label",
				hrefPrefix: "/inbox",
				badgeVariant: "outline",
			}}
		/>
	);
}
