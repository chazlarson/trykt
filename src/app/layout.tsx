import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { Shell } from "@/components/shell";
import { getSession, usernameOf } from "@/session";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], display: "swap" });

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "trykt",
  description: "A personal log of movies and shows.",
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const username = session ? usernameOf(session.user) : null;
  return (
    <html lang="en">
      <body className={geist.className}>
        <Shell username={username}>{children}</Shell>
      </body>
    </html>
  );
}
