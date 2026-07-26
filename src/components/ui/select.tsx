import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A native `<select>` shaped exactly like `Input`.
 *
 * Nineteen selects were previously styled by hand, and they disagreed in every
 * dimension: three heights (40/38/28px), three backgrounds (transparent, `--surface`,
 * `--surface-subtle`), and `--border` throughout where every input uses
 * `--border-strong`. Where a select sat beside an input on one row the two were
 * visibly different sizes.
 *
 * The geometry here is `Input`'s, deliberately duplicated value-for-value rather than
 * abstracted: as far as a form row is concerned a select *is* an input, and the two
 * must be changed together or not at all.
 *
 * `size="sm"` matches `Button`'s `sm` for the compact in-row controls.
 */
export interface SelectProps extends Omit<React.ComponentProps<"select">, "size"> {
	size?: "default" | "sm";
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
	({ className, size = "default", ...props }, ref) => (
		<select
			className={cn(
				"w-full rounded-[6px] border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50",
				size === "sm" ? "h-7 px-2 text-xs" : "h-9 text-sm",
				className,
			)}
			ref={ref}
			{...props}
		/>
	),
);
Select.displayName = "Select";
