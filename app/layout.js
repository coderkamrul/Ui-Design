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
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              // Suppress external Chrome extension runtime errors from crashing Next.js dev overlay
              if (typeof window !== "undefined") {
                window.addEventListener("error", function(e) {
                  var fn = e && e.filename;
                  var stk = e && e.error && e.error.stack;
                  if ((fn && fn.indexOf("chrome-extension://") !== -1) || (stk && stk.indexOf("chrome-extension://") !== -1)) {
                    e.stopImmediatePropagation();
                    e.preventDefault();
                  }
                }, true);
                window.addEventListener("unhandledrejection", function(e) {
                  var r = e && e.reason;
                  var stk = r && r.stack;
                  var msg = r && (r.message || String(r));
                  if ((stk && stk.indexOf("chrome-extension://") !== -1) || (msg && msg.indexOf("Failed to fetch") !== -1 && stk && stk.indexOf("frame_ant") !== -1)) {
                    e.stopImmediatePropagation();
                    e.preventDefault();
                  }
                }, true);
              }
            `,
          }}
        />
      </head>
      <body className="antialiased font-sans">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
