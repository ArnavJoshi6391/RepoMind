import type { ReactNode } from "react";

export const metadata = {
  title: "RepoMind Foundation",
  description: "AI-powered software engineering platform foundation",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
