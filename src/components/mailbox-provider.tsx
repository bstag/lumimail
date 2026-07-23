"use client";

import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useState,
} from "react";
import type { ReactNode } from "react";
import { fetchMailboxOptions } from "./mailbox-provider-utils";

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

const STORAGE_KEY = "selected-mailbox-id";

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
	const [mailboxes, setMailboxes] = useState<MailboxOption[]>([]);
	const [selectedMailbox, setSelectedMailboxState] = useState<MailboxOption | null>(null);
	const [isLoading, setIsLoading] = useState(true);

	useEffect(() => {
		let cancelled = false;

		fetchMailboxOptions()
			.then((items) => {
				if (cancelled) return;
				setMailboxes(items);

				const storedId = safeStorageGet(STORAGE_KEY);
				if (storedId) {
					const found = items.find((mb) => mb.id === storedId);
					if (found) {
						setSelectedMailboxState(found);
						return;
					}
				}

				const primary = items.find((mb) => mb.isPrimary) ?? items[0] ?? null;
				if (primary) {
					setSelectedMailboxState(primary);
					safeStorageSet(STORAGE_KEY, primary.id);
				}
			})
			.catch((err) => {
				if (process.env.NODE_ENV !== "production") console.error("Failed to load mailboxes", err);
			})
			.finally(() => {
				if (!cancelled) setIsLoading(false);
			});

		return () => {
			cancelled = true;
		};
	}, []);

	const setSelectedMailbox = useCallback((mb: MailboxOption | null) => {
		setSelectedMailboxState(mb);
		if (mb) {
			setMailboxes((items) => items.map((item) => (item.id === mb.id ? mb : item)));
			safeStorageSet(STORAGE_KEY, mb.id);
		} else {
			safeStorageRemove(STORAGE_KEY);
		}
	}, []);

	return (
		<MailboxContext.Provider value={{ selectedMailbox, setSelectedMailbox, mailboxes, isLoading }}>
			{children}
		</MailboxContext.Provider>
	);
}
