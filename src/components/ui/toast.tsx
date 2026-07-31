"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

type ToastEntry = { id: number; message: string };
type ToastListener = (message: string) => void;

let activeListener: ToastListener | null = null;
let queuedMessages: string[] = [];

const TOAST_DURATION_MS = 6000;

/**
 * Shows a dismissible error toast. Safe to call from non-React code (the
 * global MutationCache onError); messages fired before the `Toaster` mounts
 * are queued and flushed on mount.
 */
export function showErrorToast(message: string): void {
	if (activeListener) {
		activeListener(message);
	} else {
		queuedMessages.push(message);
	}
}

/** Renders the error-toast stack. Mounted once, inside `Providers`. */
export function Toaster() {
	const [toasts, setToasts] = useState<ToastEntry[]>([]);
	const nextIdRef = useRef(0);
	const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

	useEffect(() => {
		const timers = timersRef.current;
		const push = (message: string) => {
			nextIdRef.current += 1;
			const id = nextIdRef.current;
			setToasts((current) => [...current, { id, message }]);
			timers.push(
				setTimeout(() => {
					setToasts((current) => current.filter((toast) => toast.id !== id));
				}, TOAST_DURATION_MS),
			);
		};

		activeListener = push;
		const pending = queuedMessages;
		queuedMessages = [];
		pending.forEach(push);

		return () => {
			if (activeListener === push) activeListener = null;
			timers.forEach(clearTimeout);
		};
	}, []);

	if (toasts.length === 0) return null;

	return (
		<div
			aria-live="assertive"
			className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(360px,calc(100vw-32px))] flex-col gap-2"
		>
			{toasts.map((toast) => (
				<div
					key={toast.id}
					role="alert"
					className="pointer-events-auto flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-muted px-4 py-3 shadow-md shadow-border"
				>
					<p className="min-w-0 flex-1 break-words text-sm text-danger">{toast.message}</p>
					<button
						type="button"
						onClick={() =>
							setToasts((current) => current.filter((entry) => entry.id !== toast.id))
						}
						className="rounded p-0.5 text-danger hover:bg-danger/10"
						aria-label="Dismiss notification"
					>
						<X className="h-4 w-4" />
					</button>
				</div>
			))}
		</div>
	);
}
