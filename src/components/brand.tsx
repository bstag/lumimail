import { cn } from "@/lib/utils";

export function PicketMark({ className }: { className?: string }) {
	return (
		<span
			data-brand-mark="true"
			aria-hidden="true"
			className={cn("relative inline-block shrink-0 text-ink", className)}
		>
			<span className="absolute inset-0 bg-current [mask-image:url('/brand/picket-mark-boundary-mask.png')] [mask-position:center] [mask-repeat:no-repeat] [mask-size:contain]" />
			<span className="absolute inset-0 bg-brand-signal [mask-image:url('/brand/picket-mark-signal-mask.png')] [mask-position:center] [mask-repeat:no-repeat] [mask-size:contain]" />
		</span>
	);
}

export function BrandLockup({
	className,
	markClassName,
	tagline,
	taglineClassName,
	wordmarkClassName,
}: {
	className?: string;
	markClassName?: string;
	tagline?: string;
	taglineClassName?: string;
	wordmarkClassName?: string;
}) {
	return (
		<span className={cn("inline-flex items-center gap-3", className)}>
			<PicketMark className={cn("h-7 w-7", markClassName)} />
			<span className="flex min-w-0 flex-col">
				<span className={cn("font-display font-semibold tracking-tight text-ink", wordmarkClassName)}>Picket</span>
				{tagline ? <span className={cn("text-xs text-ink-muted", taglineClassName)}>{tagline}</span> : null}
			</span>
		</span>
	);
}

/**
 * A sparse route/boundary motif for spacious brand surfaces. It deliberately
 * stays out of message lists, tables, and dialogs where decoration costs scan speed.
 */
export function RouteMotif({ className }: { className?: string }) {
	return (
		<svg
			data-brand-route="true"
			aria-hidden="true"
			focusable="false"
			viewBox="0 0 320 240"
			fill="none"
			className={cn("pointer-events-none text-accent", className)}
		>
			<path
				d="M-18 204C44 204 54 138 112 138s65-71 122-71c31 0 51-18 104-18"
				stroke="currentColor"
				strokeWidth="2"
				strokeDasharray="7 9"
			/>
			<path d="M72 28h155l48 48v112H120l-48-48V28Z" stroke="currentColor" strokeWidth="1.5" />
			<circle cx="112" cy="138" r="8" fill="var(--brand-signal, #E06A3B)" />
			<circle cx="234" cy="67" r="5" fill="currentColor" />
		</svg>
	);
}
