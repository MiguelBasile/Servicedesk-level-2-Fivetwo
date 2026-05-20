import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Service Desk Level 2 Dashboard",
  description: "Customer-scoped Azure DevOps service health dashboard"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
