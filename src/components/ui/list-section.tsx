import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export type ListSectionProps = {
	loading: boolean;
	loadingLabel: string;
	empty: boolean;
	emptyLabel: ReactNode;
	emptyIcon: LucideIcon;
	children: ReactNode;
};

/**
 * The standard loading / empty / list progression for resource lists.
 *
 * Three divergent stylings existed (bordered card paragraph, plain paragraph,
 * dashed panel with icon); this standardizes on the bordered row while loading
 * and the dashed panel with an icon when empty (T-23).
 */
export function ListSection({
	loading,
	loadingLabel,
	empty,
	emptyLabel,
	emptyIcon: EmptyIcon,
	children,
}: ListSectionProps) {
	if (loading) {
		return (
			<p className="rounded-lg border border-border bg-surface-raised px-4 py-3 text-sm text-ink-muted">
				{loadingLabel}
			</p>
		);
	}
	if (empty) {
		return (
			<div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-12 text-center">
				<EmptyIcon className="mb-3 h-8 w-8 text-ink-faint" />
				<p className="text-sm text-ink-muted">{emptyLabel}</p>
			</div>
		);
	}
	return <>{children}</>;
}
