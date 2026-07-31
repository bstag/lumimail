"use client";

import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import type { ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchMailboxOptions } from "./mailbox-provider-utils";
import { mailboxKeys } from "@/lib/query-keys";
import {
	registerAccountStateReset,
	SELECTED_MAILBOX_STORAGE_KEY,
} from "@/lib/auth/account-state";

export type MailboxOption = {
	id: string;
	localPart: string;
	hostname: string;
	displayName: string | null;
	role: "viewer" | "responder" | "manager";
	isPrimary?: boolean;
};

type MailboxContextValue = {
	selectedMailbox: MailboxOption | null;
	setSelectedMailbox: (mb: MailboxOption | null) => void;
	mailboxes: MailboxOption[];
	isLoading: boolean;
};

const MailboxContext = createContext<MailboxContextValue | null>(null);

export function useSelectedMailbox() {
	const ctx = useContext(MailboxContext);
	if (!ctx) throw new Error("useSelectedMailbox must be used within MailboxProvider");
	return ctx;
}

function safeStorageGet(key: string): string | null {
	try { return localStorage.getItem(key); } catch { return null; }
}

function safeStorageSet(key: string, value: string): void {
	try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
}

function safeStorageRemove(key: string): void {
	try { localStorage.removeItem(key); } catch { /* storage unavailable */ }
}

export function MailboxProvider({ children }: { children: ReactNode }) {
	const queryClient = useQueryClient();
	const [selectedMailbox, setSelectedMailboxState] = useState<MailboxOption | null>(null);
	const [selectionReady, setSelectionReady] = useState(false);

	// The mailbox list is a TanStack query (T-34). The F50 account-switch
	// contract holds because the root QueryClient clears itself on the same
	// account-state reset that fires below.
	const mailboxQuery = useQuery({
		queryKey: mailboxKeys.options,
		queryFn: fetchMailboxOptions,
		retry: false,
	});
	// Stable array identity: several consumers use `mailboxes` in effect deps.
	const mailboxes = useMemo(() => mailboxQuery.data ?? [], [mailboxQuery.data]);
	// Selection is derived in an effect one render after the list arrives, so
	// stay "loading" until it lands — consumers gate their mailbox-scoped
	// fetches on this flag, and the old provider never exposed a loaded list
	// without a selection.
	const isLoading = mailboxQuery.isPending || (!selectionReady && !mailboxQuery.isError);

	// F50: a mounted provider must drop the visible selection the moment the
	// account changes; the cleared QueryClient then refetches the new
	// account's mailboxes and the effect below re-derives the selection.
	useEffect(() => registerAccountStateReset(() => {
		setSelectedMailboxState(null);
		setSelectionReady(false);
	}), []);

	useEffect(() => {
		const items = mailboxQuery.data;
		if (!items) return;

		setSelectedMailboxState((current) => {
			if (current && items.some((mb) => mb.id === current.id)) return current;

			const storedId = safeStorageGet(SELECTED_MAILBOX_STORAGE_KEY);
			if (storedId) {
				const found = items.find((mb) => mb.id === storedId);
				if (found) return found;
			}

			const primary = items.find((mb) => mb.isPrimary) ?? items[0] ?? null;
			if (primary) safeStorageSet(SELECTED_MAILBOX_STORAGE_KEY, primary.id);
			return primary;
		});
		setSelectionReady(true);
	}, [mailboxQuery.data]);

	const setSelectedMailbox = useCallback((mb: MailboxOption | null) => {
		setSelectedMailboxState(mb);
		if (mb) {
			queryClient.setQueryData<MailboxOption[]>(mailboxKeys.options, (items) =>
				items?.map((item) => (item.id === mb.id ? mb : item)),
			);
			safeStorageSet(SELECTED_MAILBOX_STORAGE_KEY, mb.id);
		} else {
			safeStorageRemove(SELECTED_MAILBOX_STORAGE_KEY);
		}
	}, [queryClient]);

	return (
		<MailboxContext.Provider value={{ selectedMailbox, setSelectedMailbox, mailboxes, isLoading }}>
			{children}
		</MailboxContext.Provider>
	);
}
