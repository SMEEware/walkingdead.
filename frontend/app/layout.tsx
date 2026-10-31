import type { Metadata } from "next";
import "./globals.css";
import "./console.css";
import "@fontsource-variable/manrope";

import { AppFrame } from "../components/layout/AppFrame";
import { APP_DESCRIPTION, APP_NAME } from "../lib/constants";
import { SETTINGS_KEY, THEMES } from "../lib/themes";

export const metadata: Metadata = {
  title: APP_NAME,
  description: APP_DESCRIPTION,
};

// Applies the saved theme before first paint to avoid a flash of the default colors.
const themeScript = `(function(){try{var t=${JSON.stringify(
  Object.fromEntries(THEMES.map((t) => [t.id, t])),
)},s=JSON.parse(localStorage.getItem(${JSON.stringify(SETTINGS_KEY)})||"{}"),c=t[s.theme];if(c){var r=document.documentElement;r.style.setProperty("--accent",c.accent);r.style.setProperty("--alert",c.alert);r.dataset.theme=c.id}}catch(e){}})()`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="antialiased" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="app-body m-0 min-h-dvh bg-black text-zinc-100">
        <AppFrame>{children}</AppFrame>
      </body>
    </html>
  );
}
