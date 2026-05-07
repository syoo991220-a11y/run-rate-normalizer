import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import { StudioMemoryProvider } from "./context/studio-memory-context";
import { TopNav } from "./components/top-nav";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Run-Rate Studio",
  description:
    "Enterprise trial balance ingestion, materiality workflows, and FP&A projections.",
};

function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full dark antialiased`}
    >
      <body className="flex min-h-full flex-col bg-slate-950 font-sans text-slate-100">
        <StudioMemoryProvider>
          <div className="relative flex min-h-0 flex-1 flex-col bg-slate-950">
            <TopNav />
            <div
              className="pointer-events-none fixed inset-0 top-14 bg-[radial-gradient(ellipse_at_top,rgba(56,189,248,0.07),transparent_50%),radial-gradient(ellipse_at_bottom,rgba(99,102,241,0.05),transparent_45%)]"
              aria-hidden
            />
            <main className="relative z-0 flex min-h-0 w-full flex-1 flex-col overflow-auto pt-14">
              <div className="flex w-full flex-1 flex-col px-4 pb-10 pt-6 sm:px-6 lg:px-10">
                {children}
              </div>
            </main>
          </div>
        </StudioMemoryProvider>
        <Analytics />
      </body>
    </html>
  );
}

export default RootLayout;
