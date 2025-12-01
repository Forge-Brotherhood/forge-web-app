import type { Metadata } from "next";

// Smart App Banner for iOS - prompts users to open in the Forge app
export const metadata: Metadata = {
  other: {
    "apple-itunes-app": "app-id=6755938712, app-argument=forge://join",
  },
};

export default function JoinLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
