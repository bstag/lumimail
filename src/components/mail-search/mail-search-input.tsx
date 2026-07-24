"use client";

import { Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMailSearch } from "./mail-search-context";

export function MailSearchInput() {
	const t = useTranslations("search");
	const { query, setQuery } = useMailSearch();

	return (
		<div className="flex h-12 min-w-0 flex-1 max-w-3xl items-center gap-3 rounded-full bg-surface-subtle px-4 text-ink-muted">
			<Search className="h-5 w-5 shrink-0" />
			<input
				value={query}
				onChange={(event) => setQuery(event.target.value)}
				placeholder={t("placeholder")}
				className="h-full min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-muted"
			/>
			{query && (
				<button
					type="button"
					onClick={() => setQuery("")}
					className="rounded-full p-1 text-ink-muted hover:bg-accent-muted hover:text-ink"
					aria-label={t("clearAria")}
				>
					<X className="h-4 w-4" />
				</button>
			)}
		</div>
	);
}
