import Link from "next/link";
import { BrandLockup, RouteMotif } from "@/components/brand";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import type { AuthShellProps } from "./types";

export function AuthShell({ title, description, children, footer, steps }: AuthShellProps) {
	return (
		<div className="min-h-dvh bg-surface p-4 text-ink sm:p-6">
			{/* These used to float over the bottom-right corner of the card. A header is
			    where the rest of the app keeps them, and on a small screen the floating
			    pair sat on top of the form it was next to. */}
			<header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3">
				<Link href="/" aria-label="Picket home" className="min-w-0">
					<BrandLockup
						className="gap-2"
						markClassName="h-7 w-7"
						tagline="Own the route. Control the inbox."
						taglineClassName="hidden sm:block"
					/>
				</Link>
				<div className="flex shrink-0 items-center gap-1">
					<LanguageSwitcher />
					<ThemeToggle />
				</div>
			</header>
			<div className="mx-auto flex min-h-[calc(100dvh-88px)] max-w-6xl items-center sm:min-h-[calc(100dvh-104px)]">
				<div className="relative mx-auto w-full max-w-xl overflow-hidden rounded-[2rem] border border-border bg-surface-raised shadow-xl shadow-border/40">
					<div aria-hidden className="h-1 w-full bg-brand-signal" />
					<RouteMotif className="absolute -right-16 -top-10 h-64 w-80 opacity-[0.07]" />
					<section className="relative flex flex-col justify-between p-6 sm:p-10">
						<div>
							<div className="mb-8">
								<h1 className="max-w-sm text-4xl font-semibold leading-tight tracking-tight text-ink">
									{title}
								</h1>
								{description && <p className="mt-4 max-w-md text-sm leading-6 text-ink-muted">{description}</p>}
							</div>
							{steps && (
								<div className="mb-8 flex gap-2 text-xs font-semibold">
									{steps.map((step, index) => (
										<span key={step.label} className="flex items-center gap-2">
											<span className={step.active ? "text-accent" : "text-ink-faint"}>
												{index + 1} {step.label}
											</span>
											{index < steps.length - 1 && <span className="text-ink-faint">/</span>}
										</span>
									))}
								</div>
							)}
							{children}
						</div>
						<div className="mt-8 text-sm font-medium text-accent">{footer}</div>
					</section>
				</div>
			</div>
		</div>
	);
}
