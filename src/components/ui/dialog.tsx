"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
	className,
	children,
	...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>) {
	return (
		<DialogPrimitive.Portal>
			{/*
			  A scrim must darken whatever is behind it. `--ink` cannot do that job: it is
			  near-black in light and near-white in dark, so the same declaration dimmed
			  one theme and bloomed the other, leaving the dark modal floating on a
			  lightened page it barely separated from. Black matches the sidebar overlays,
			  which is the app's other scrim.
			*/}
			<DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40" />
			<DialogPrimitive.Content
				className={cn(
					// `max-h` with internal scrolling keeps a tall dialog inside the viewport.
					// Centring by transform alone let one grow past both edges with no way to
					// reach its own buttons.
					"fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-32px)] w-[min(520px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-[8px] border border-[var(--border)] bg-[var(--surface-raised)] p-4",
					className,
				)}
				{...props}
			>
				{children}
				<DialogPrimitive.Close className="absolute right-3 top-3 rounded-full p-1 text-[var(--ink-muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--ink)]">
					<X className="h-4 w-4" />
					<span className="sr-only">Close</span>
				</DialogPrimitive.Close>
			</DialogPrimitive.Content>
		</DialogPrimitive.Portal>
	);
}

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
	return <div className={cn("mb-5 space-y-1.5", className)} {...props} />;
}

export function DialogTitle({
	className,
	...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>) {
	return <DialogPrimitive.Title className={cn("text-lg font-semibold text-[var(--ink)]", className)} {...props} />;
}

export function DialogDescription({
	className,
	...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>) {
	return <DialogPrimitive.Description className={cn("text-sm text-[var(--ink-muted)]", className)} {...props} />;
}
