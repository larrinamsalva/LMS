import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "LMS · Your business, your way",
  description:
    "One engine. Any business. Your data. Your control. An open-source management foundation.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
