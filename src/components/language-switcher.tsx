"use client";

import { useLocale } from "next-intl";
import { locales, localeLabels, localeFlags, type Locale } from "@/i18n/config";

export function LanguageSwitcher() {
  const currentLocale = useLocale() as Locale;

  function handleChange(locale: Locale) {
    document.cookie = [
      `NEXT_LOCALE=${locale}`,
      "Path=/",
      `Max-Age=${365 * 24 * 60 * 60}`,
      "SameSite=Lax",
    ].join("; ");
    window.location.reload();
  }

  return (
    <div className="fixed bottom-4 right-4 z-30">
      <select
        value={currentLocale}
        onChange={(e) => handleChange(e.target.value as Locale)}
        className="rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm font-medium text-ink-muted shadow-sm transition-colors hover:border-border-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:opacity-50"
        aria-label="Select language"
      >
        {locales.map((locale) => (
          <option key={locale} value={locale}>
            {localeFlags[locale]} {localeLabels[locale]}
          </option>
        ))}
      </select>
    </div>
  );
}
