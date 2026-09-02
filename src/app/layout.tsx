import type { Metadata } from "next";
import { Geist, Geist_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/features/auth/auth-provider";
import { ThemeProvider } from "next-themes";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

const displayFont = Space_Grotesk({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "FormNull — Build forms that get out of the way",
    template: "%s · FormNull",
  },
  description:
    "FormNull is the form builder for teams that ship. Design beautiful forms, collect submissions at scale, and own your data. Powered by Supabase.",
  keywords: [
    "form builder",
    "online forms",
    "survey tool",
    "Supabase forms",
    "SaaS forms",
    "data collection",
  ],
  authors: [{ name: "FormNull" }],
  applicationName: "FormNull",
  robots: { index: true, follow: true },
  openGraph: {
    title: "FormNull — Build forms that get out of the way",
    description:
      "Design beautiful forms, collect submissions at scale, and own your data.",
    type: "website",
    siteName: "FormNull",
  },
  twitter: {
    card: "summary_large_image",
    title: "FormNull",
    description:
      "Design beautiful forms, collect submissions at scale, and own your data.",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf7f0" },
    { media: "(prefers-color-scheme: dark)", color: "#1a1a2e" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${displayFont.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem={false}
          disableTransitionOnChange
        >
          <AuthProvider>
            {children}
            <Toaster richColors position="top-center" />
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
