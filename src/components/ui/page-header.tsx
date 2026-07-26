import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The title block at the top of a page.
 *
 * Every page hand-rolled this, and they drifted: ten pages used
 * `text-2xl font-semibold` while `/members` used an `h2` at `text-xl`, and the gap
 * between title and description was `mt-1`, `mt-2`, or a `space-y-6` inherited from
 * the page wrapper depending on where you looked. The heading level mattered too —
 * a page whose title is an `h2` has no `h1` at all.
 *
 * `action` is the slot for a primary control that belongs on the title row, such as
 * "New mailbox".
 */
export function PageHeader({
	title,
	description,
	action,
	className,
}: {
	title: React.ReactNode;
	description?: React.ReactNode;
	action?: React.ReactNode;
	className?: string;
}) {
	return (
		<div className={cn("flex items-start justify-between gap-4", className)}>
			<div className="min-w-0">
				<h1 className="text-2xl font-semibold text-ink">{title}</h1>
				{description ? <p className="mt-1 text-sm text-ink-muted">{description}</p> : null}
			</div>
			{action ? <div className="shrink-0">{action}</div> : null}
		</div>
	);
}
