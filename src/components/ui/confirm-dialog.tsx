"use client";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";

export type ConfirmDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	description: string;
	/** Label for the confirming button (switch it while `pending` for progress text). */
	confirmLabel: string;
	cancelLabel?: string;
	/** Styles the confirm button as destructive. */
	danger?: boolean;
	/** Disables both buttons while the confirmed action runs. */
	pending?: boolean;
	/** Inline error, e.g. from a failed previous attempt; keeps the dialog open. */
	error?: string | null;
	onConfirm: () => void;
};

/**
 * Accessible replacement for `window.confirm()`, modeled on the API-keys
 * revoke dialog. The caller owns the open state and must only run the
 * side-effect from `onConfirm` — never before the dialog resolves.
 */
export function ConfirmDialog({
	open,
	onOpenChange,
	title,
	description,
	confirmLabel,
	cancelLabel = "Cancel",
	danger = false,
	pending = false,
	error = null,
	onConfirm,
}: ConfirmDialogProps) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>
				{error && <p className="text-sm text-danger">{error}</p>}
				<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
					<Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
						{cancelLabel}
					</Button>
					<Button
						variant={danger ? "destructive" : "default"}
						onClick={onConfirm}
						disabled={pending}
					>
						{confirmLabel}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
