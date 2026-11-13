import type { Metadata } from "next";
import { Cairo, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "@/components/theme-provider";

const cairo = Cairo({
  variable: "--font-cairo",
  subsets: ["arabic", "latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "مولّد الوسائط الذكي | MCP Media Generator",
  description:
    "نظام متكامل لتوليد الصور والفيديوهات وأتمتة محتوى منصات التواصل الاجتماعي عبر MCP. مدعوم بـ Turso و kie.ai مع مبدّل مفاتيح تلقائي.",
  keywords: [
    "MCP",
    "AI Media",
    "Social Media",
    "Image Generation",
    "Video Generation",
    "kie.ai",
    "Turso",
    "مولّد الوسائط",
  ],
  authors: [{ name: "Social Media MCP" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "مولّد الوسائط الذكي MCP",
    description: "أتمتة محتوى منصات التواصل الاجتماعي بالذكاء الاصطناعي",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning className="dark">
      <body
        className={`${cairo.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
