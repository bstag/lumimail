import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export type FormFieldProps = {
	label: ReactNode;
	/** Forwarded to the `<Label htmlFor>`; give the control the matching `id`. */
	htmlFor?: string;
	className?: string;
	children: ReactNode;
};

/** The standard label-above-control form row (`space-y-2` + `Label`). */
export function FormField({ label, htmlFor, className, children }: FormFieldProps) {
	return (
		<div className={cn("space-y-2", className)}>
			<Label htmlFor={htmlFor}>{label}</Label>
			{children}
		</div>
	);
}
