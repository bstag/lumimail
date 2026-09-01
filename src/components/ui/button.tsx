import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
	"inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[6px] text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
	{
		variants: {
			variant: {
				default: "bg-[var(--accent)] text-[var(--accent-ink)] hover:brightness-90",
				outline: "border border-[var(--border-strong)] text-[var(--ink)] hover:bg-[var(--surface-subtle)]",
				ghost: "text-[var(--ink)] hover:bg-[var(--surface-subtle)]",
				destructive: "bg-[var(--danger)] text-white hover:brightness-90",
			},
			// Radius lives on the base, not per size: a button's corner should not depend
			// on how tall it is. Every size previously overrode the base with a different
			// value, so the app shipped rectangular buttons at 12px, 8px, and 16px, none
			// of which matched the 6px on inputs and cards beside them.
			size: {
				default: "h-9 px-6 py-2",
				sm: "h-7 px-3 text-xs",
				lg: "h-11 px-8",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	},
);

export interface ButtonProps
	extends React.ButtonHTMLAttributes<HTMLButtonElement>,
		VariantProps<typeof buttonVariants> {
	asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
	({ className, variant, size, asChild = false, ...props }, ref) => {
		const Comp = asChild ? Slot : "button";
		return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
	},
);
Button.displayName = "Button";
