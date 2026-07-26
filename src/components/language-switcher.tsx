"use client";

import { useLocale } from "next-intl";
import { locales, localeLabels, localeFlags, type Locale } from "@/i18n/config";

function setLocaleCookie(locale: Locale) {
  document.cookie = [
    `NEXT_LOCALE=${locale}`,
    "Path=/",
    `Max-Age=${365 * 24 * 60 * 60}`,
    "SameSite=Lax",
  ].join("; ");
  window.location.reload();
}

/**
 * Locale picker, as a header icon showing the current flag.
 *
 * The `<select>` is a real one, laid transparently over the flag rather than replaced
 * by a custom menu. That keeps three things a hand-built dropdown would have cost:
 * the platform's own picker on a phone, the full language names in the open list
 * (a flag alone is a poor way to find a language you do not already read), and native
 * keyboard and screen-reader behaviour.
 *
 * Only the closed state is compressed to an icon — which is the whole requirement,
 * since that is what occupies the header.
 */
export function LanguageSwitcher() {
  const currentLocale = useLocale() as Locale;

  return (
    <span className="relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-subtle">
      {/* The locale code, not the flag. Regional-indicator emoji have no glyph on
          Windows and fall back to the region letters — so a British English user saw
          "GB", which names a country rather than a language and looked different on
          every platform. Two letters render identically everywhere. */}
      <span aria-hidden className="text-xs font-semibold uppercase tracking-wide">
        {currentLocale}
      </span>
      <select
        value={currentLocale}
        onChange={(event) => setLocaleCookie(event.target.value as Locale)}
        aria-label="Select language"
        className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0"
      >
        {locales.map((locale) => (
          <option key={locale} value={locale}>
            {localeFlags[locale]} {localeLabels[locale]}
          </option>
        ))}
      </select>
    </span>
  );
}
