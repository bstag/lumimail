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
    <div className="fixed bottom-4 right-4 z-50">
      <select
        value={currentLocale}
        onChange={(e) => handleChange(e.target.value as Locale)}
        className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-700 shadow-sm transition-colors hover:border-neutral-300 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:opacity-50"
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
