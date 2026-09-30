import Link from "next/link";
import { homePurpose } from "@/lib/legal/legal-content";

export function HomePurposeSection() {
	return (
		<section
			aria-labelledby="home-purpose-title"
			className="mx-auto max-w-7xl px-4 pb-16 sm:px-6 lg:px-8"
		>
			<div className="rounded-2xl border border-border bg-surface-raised p-6 sm:p-8">
				<h2 id="home-purpose-title" className="font-display text-2xl font-semibold tracking-tight text-ink">
					{homePurpose.title}
				</h2>
				<div className="mt-6 grid gap-8 lg:grid-cols-3">
					{homePurpose.sections.map((section) => (
						<div key={section.id}>
							<h3 className="font-semibold text-ink">{section.title}</h3>
							{section.paragraphs?.map((paragraph) => (
								<p key={paragraph} className="mt-2 text-sm leading-6 text-ink-muted">
									{paragraph}
								</p>
							))}
							{section.items ? (
								<ul className="mt-2 list-disc space-y-2 ps-5 text-sm leading-6 text-ink-muted marker:text-ink-faint">
									{section.items.map((item) => (
										<li key={item}>{item}</li>
									))}
								</ul>
							) : null}
							{section.links ? (
								<ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
									{section.links.map((link) => (
										<li key={link.href}>
											<Link href={link.href} className="text-accent underline underline-offset-4 hover:opacity-80">
												{link.label}
											</Link>
										</li>
									))}
								</ul>
							) : null}
						</div>
					))}
				</div>
			</div>
		</section>
	);
}
