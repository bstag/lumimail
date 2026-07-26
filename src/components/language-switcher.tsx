"use client";

import { Languages } from "lucide-react";
import { useLocale } from "next-intl";
import { locales, localeLabels, localeFlags, type Locale } from "@/i18n/config";
import { Select } from "@/components/ui/select";

function setLocaleCookie(locale: Locale) {
  document.cookie = [
    `NEXT_LOCALE=${locale}`,
    "Path=/",
    `Max-Age=${365 * 24 * 60 * 60}`,
    "SameSite=Lax",
  ].join("; ");
  window.location.reload();
}

export function LanguageSwitcher({
  variant = "floating",
}: {
  variant?: "floating" | "inline";
}) {
  const currentLocale = useLocale() as Locale;

  if (variant === "inline") {
    return (
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-subtle text-ink-muted">
          <Languages className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <label
            htmlFor="language-select-inline"
            className="text-sm font-medium text-ink"
          >
            Language
          </label>
          <Select
            id="language-select-inline"
            value={currentLocale}
            onChange={(e) => setLocaleCookie(e.target.value as Locale)}
            size="sm" className="mt-1 truncate"
          >
            {locales.map((locale) => (
              <option key={locale} value={locale}>
                {localeFlags[locale]} {localeLabels[locale]}
              </option>
            ))}
          </Select>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-30">
      <Select
        value={currentLocale}
        onChange={(e) => setLocaleCookie(e.target.value as Locale)}
        className="max-w-[45vw] truncate sm:max-w-none"
        aria-label="Select language"
      >
        {locales.map((locale) => (
          <option key={locale} value={locale}>
            {localeFlags[locale]} {localeLabels[locale]}
          </option>
        ))}
      </Select>
    </div>
  );
}
