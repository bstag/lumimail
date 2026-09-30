import Link from "next/link";
import { BrandLockup } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { LEGAL_OPERATOR, type LegalDocument } from "@/lib/legal/legal-content";

const footerLinks = [
	{ href: "/", label: "Home" },
	{ href: "/privacy", label: "Privacy Policy" },
	{ href: "/terms", label: "Terms of Service" },
] as const;

export function LegalDocumentView({ document }: { document: LegalDocument }) {
	return (
		<div className="min-h-dvh bg-surface text-ink">
			<header className="mx-auto flex h-16 w-full max-w-3xl items-center justify-between px-4 sm:px-6">
				<Link href="/" aria-label="Picket home" className="flex items-center gap-3">
					<BrandLockup className="gap-2" markClassName="h-7 w-7" wordmarkClassName="text-base" />
				</Link>
				<ThemeToggle />
			</header>

			<main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-6 sm:px-6">
				<article>
					<h1 className="font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
						{document.title}
					</h1>
					<p className="mt-3 text-sm text-ink-muted">Effective {document.effectiveDate}</p>
					<p className="mt-4 text-base leading-7 text-ink-muted">{document.summary}</p>

					{document.sections.map((section) => (
						<section key={section.id} id={section.id} aria-labelledby={`${section.id}-title`} className="mt-10 scroll-mt-8">
							<h2 id={`${section.id}-title`} className="text-xl font-semibold text-ink">
								{section.title}
							</h2>
							{section.paragraphs?.map((paragraph) => (
								<p key={paragraph} className="mt-3 break-words text-base leading-7 text-ink">
									{paragraph}
								</p>
							))}
							{section.items ? (
								<ul className="mt-3 list-disc space-y-2 ps-6 text-base leading-7 text-ink marker:text-ink-faint">
									{section.items.map((item) => (
										<li key={item} className="break-words">
											{item}
										</li>
									))}
								</ul>
							) : null}
							{section.links ? (
								<ul className="mt-3 space-y-1 text-base">
									{section.links.map((link) => (
										<li key={link.href}>
											<a
												href={link.href}
												className="break-all text-accent underline underline-offset-4 hover:opacity-80"
												{...(link.href.startsWith("https://") ? { rel: "noopener noreferrer" } : {})}
											>
												{link.label}
											</a>
										</li>
									))}
								</ul>
							) : null}
						</section>
					))}
				</article>
			</main>

			<footer className="border-t border-border">
				<div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-ink-muted sm:px-6">
					<span>
						{LEGAL_OPERATOR.service} is operated by {LEGAL_OPERATOR.company}
					</span>
					<nav aria-label="Legal">
						<ul className="flex flex-wrap gap-x-5 gap-y-2">
							{footerLinks.map((link) => (
								<li key={link.href}>
									<Link href={link.href} className="underline-offset-4 hover:text-ink hover:underline">
										{link.label}
									</Link>
								</li>
							))}
						</ul>
					</nav>
				</div>
			</footer>
		</div>
	);
}
