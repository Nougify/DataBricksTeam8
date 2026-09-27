import type { Metadata } from "next";
import { Atkinson_Hyperlegible_Next, Barlow_Semi_Condensed } from "next/font/google";
import { APP } from "@/config/app";
import { Providers } from "./providers";
import "./globals.css";

// Body, UI and every table/number: designed for low-vision legibility, so it holds up on a projector.
// Variable font (wght 200-800); tabular figures are switched on globally in globals.css.
const sans = Atkinson_Hyperlegible_Next({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

// Headings, the sim clock, KPI values, countdowns and route plates: a signage-derived condensed face.
const heading = Barlow_Semi_Condensed({
  variable: "--font-heading",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: APP.name,
  ...(APP.tagline ? { description: APP.tagline } : {}),
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${sans.variable} ${heading.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
