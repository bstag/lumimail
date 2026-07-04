import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;

  const { locales, defaultLocale } = await import("./config");
  type Locale = (typeof locales)[number];
  const cookieLocale = (await cookies()).get("NEXT_LOCALE")?.value;

  if (!locale || !locales.includes(locale as Locale)) {
    locale = locales.includes(cookieLocale as Locale) ? cookieLocale : defaultLocale;
  }

  const resolvedLocale = locale as Locale;

  return {
    locale: resolvedLocale,
    messages: (await import(`./messages/${resolvedLocale}.json`)).default,
  };
});
