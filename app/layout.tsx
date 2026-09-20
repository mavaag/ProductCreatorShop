import "./globals.css";
import Link from "next/link";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";

const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata = {
  title: "Werkplaats — productbeheer",
  description: "Producten, prijsberekening en WooCommerce-export",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl" className={`${plexSans.variable} ${plexMono.variable}`}>
      <body>
        <nav className="topnav">
          <Link href="/products" className="brand">
            <span className="brand-dot" aria-hidden="true" />
            Werkplaats
          </Link>
          <div className="navlinks">
            <Link href="/products">Producten</Link>
            <Link href="/machines">Machines</Link>
            <Link href="/materials">Materialen</Link>
            <Link href="/margins">Marges</Link>
            <Link href="/prices">Prijzen</Link>
          </div>
        </nav>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
