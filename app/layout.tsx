import type { Metadata } from "next";
import "./styles.css";
import "./extra.css";

export const metadata: Metadata = { title: "Post House | Content studio", description: "Create, schedule, and compare social content." };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
