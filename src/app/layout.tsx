import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { rtlLocales } from "@/i18n/config";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { ServiceWorkerRegistration } from "@/components/service-worker-registration";
import "./globals.css";

// Applies the saved theme before first paint to avoid a light/dark flash.
const themeScript = `(function(){try{var t=localStorage.getItem('theme');if(t==='dark'||t==='light'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`;

const geistSans = Geist({
	variable: "--font-geist-sans",
	subsets: ["latin"],
});

const geistMono = Geist_Mono({
	variable: "--font-geist-mono",
	subsets: ["latin"],
});

export const metadata: Metadata = {
	applicationName: "Lumimail",
	title: "Lumimail",
	description: "Multi-tenant email on Cloudflare",
	manifest: "/manifest.webmanifest",
	icons: {
		icon: [
			{ url: "/favicon.ico" },
			{ url: "/icon-192.png", sizes: "192x192", type: "image/png" },
			{ url: "/icon-512.png", sizes: "512x512", type: "image/png" },
		],
		apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
	},
	appleWebApp: {
		capable: true,
		title: "Lumimail",
		statusBarStyle: "default",
	},
	formatDetection: {
		telephone: false,
	},
};

export const viewport: Viewport = {
	colorScheme: "light dark",
	themeColor: "#2563eb",
	viewportFit: "cover",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
	const locale = await getLocale();
	const messages = await getMessages();
	const dir = rtlLocales.includes(locale as (typeof rtlLocales)[number]) ? "rtl" : "ltr";

	return (
		<html lang={locale} dir={dir}>
			<body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
				<script dangerouslySetInnerHTML={{ __html: themeScript }} />
				<NextIntlClientProvider messages={messages}>
					<Providers>
						<ServiceWorkerRegistration />
						<LanguageSwitcher />
						<ThemeToggle />
						{children}
					</Providers>
				</NextIntlClientProvider>
			</body>
		</html>
	);
}
