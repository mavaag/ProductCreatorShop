import "./globals.css";
import Link from "next/link";
import localFont from "next/font/local";
import { DialogHost } from "@/components/DialogHost";
import { LicenseAlert } from "@/components/LicenseAlert";

// Lettertypes zitten in de repo (app/fonts, SIL OFL 1.1): de build hangt zo niet af van Google Fonts.
const sans = localFont({
  src: [
    { path: "./fonts/rajdhani-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/rajdhani-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./fonts/rajdhani-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-sans",
  display: "swap",
});
const mono = localFont({
  src: "./fonts/share-tech-mono-latin-400-normal.woff2",
  weight: "400",
  variable: "--font-mono",
  display: "swap",
});
const display = localFont({
  src: [
    { path: "./fonts/orbitron-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./fonts/orbitron-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-display",
  display: "swap",
});

export const metadata = {
  title: "Product Beheer Webshop",
  description: "Producten, prijsberekening en WooCommerce-export",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl" className={`${sans.variable} ${mono.variable} ${display.variable}`}>
      <body>
        <nav className="topnav">
          <Link href="/products" className="brand">
            <img
              src="https://3dprintforyou.be/wp-content/uploads/2025/09/Logo2-1.png"
              alt="3D Print For You Logo"
              className="brand-logo"
              style={{ height: '32px', marginRight: '12px' }}
            />
            Product Beheer Webshop
          </Link>
          <div className="navlinks">
            <Link href="/products">Producten</Link>
            <Link href="/catalog">Catalogus</Link>
            <Link href="/licenses">Licenties</Link>
            <Link href="/collections">Collecties</Link>
            <Link href="/machines">Machines</Link>
            <Link href="/materials">Materialen</Link>
            <Link href="/margins">Marges</Link>
            <Link href="/prices">Prijzen</Link>
            <Link href="/orders">Bestellingen</Link>
            <Link href="/customers">Klanten</Link>
            <Link href="/acties">Acties</Link>
            <Link href="/campaigns">Campagnes</Link>
            <Link href="/social">Social</Link>
            <Link href="/mockup">Mockup</Link>
            <Link href="/help" title="Handleiding">Help</Link>
          </div>
        </nav>
        <main className="container"><LicenseAlert />{children}</main>
        <DialogHost />
      </body>
    </html>
  );
}
