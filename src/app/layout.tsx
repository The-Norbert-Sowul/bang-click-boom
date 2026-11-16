import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bang Click Boom (BCB) — AI Co-Working Hub",
  description: "Personal Todo lists, projects, and portfolios co-managed with Gemini",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased selection:bg-bcb-cerulean selection:text-white">
        {children}
      </body>
    </html>
  );
}
