import { cn } from "@/lib/utils";

const LEFT_BOUNDARY = "M29 4 8 13v19c0 13 7 23 21 29V47c-7-4-11-9-11-16V20l11-5V4Z";
const RIGHT_BOUNDARY = "m35 4 21 9v18h-9V20l-12-5V4Zm12 35h9c-2 10-9 17-21 22V48c6-3 10-6 12-9Z";
const ROUTE = "M29 22v9l8 8-8 8v9l17-17-17-17Z";
const WAYPOINT = "m22 27 5 5-5 5-5-5 5-5Z";

export function PicketMark({ className }: { className?: string }) {
	return (
		<svg
			data-brand-mark="true"
			aria-hidden="true"
			focusable="false"
			viewBox="0 0 64 64"
			className={cn("shrink-0 text-ink", className)}
		>
			<path fill="currentColor" d={LEFT_BOUNDARY} />
			<path fill="currentColor" d={RIGHT_BOUNDARY} />
			<path fill="currentColor" d={ROUTE} />
			<path fill="var(--brand-signal, #E06A3B)" d={WAYPOINT} />
		</svg>
	);
}

export function BrandLockup({
	className,
	markClassName,
	tagline,
	wordmarkClassName,
}: {
	className?: string;
	markClassName?: string;
	tagline?: string;
	wordmarkClassName?: string;
}) {
	return (
		<span className={cn("inline-flex items-center gap-3", className)}>
			<PicketMark className={cn("h-7 w-7", markClassName)} />
			<span className="flex min-w-0 flex-col">
				<span className={cn("font-semibold tracking-tight text-ink", wordmarkClassName)}>Picket</span>
				{tagline ? <span className="text-xs text-ink-muted">{tagline}</span> : null}
			</span>
		</span>
	);
}
