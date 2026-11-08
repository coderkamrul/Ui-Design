import "./globals.css";
import { AuthProvider } from "@/lib/auth";

export const metadata = {
  title: "Canvas Tool",
  description:
    "Original browser-based design tool (working codename), built from a behavioural spec.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="antialiased font-sans">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
