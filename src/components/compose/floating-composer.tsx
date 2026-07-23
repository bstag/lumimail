"use client";

import { ComposeForm } from "@/components/compose/compose-form";
import { useSelectedMailbox } from "@/components/mailbox-provider";
import { findSendCapableMailbox } from "@/components/mailbox-provider-utils";
import { useCompose } from "@/components/compose/compose-context";

export function FloatingComposer() {
	const { open, draftId, closeComposer } = useCompose();
	const { mailboxes } = useSelectedMailbox();
	if (!findSendCapableMailbox(mailboxes)) return null;
	if (!open) return null;
	return <ComposeForm key={draftId ?? "new"} mode="popup" draftIdToLoad={draftId} onClose={closeComposer} />;
}
