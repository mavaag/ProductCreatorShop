import "./globals.css";
import Link from "next/link";
import { Rajdhani, Share_Tech_Mono, Orbitron } from "next/font/google";
import { DialogHost } from "@/components/DialogHost";

const sans = Rajdhani({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});
const mono = Share_Tech_Mono({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-mono",
  display: "swap",
});
const display = Orbitron({
  subsets: ["latin"],
  weight: ["600", "700"],
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
            <Link href="/machines">Machines</Link>
            <Link href="/materials">Materialen</Link>
            <Link href="/margins">Marges</Link>
            <Link href="/prices">Prijzen</Link>
            <Link href="/mockup">Mockup</Link>
          </div>
        </nav>
        <main className="container">{children}</main>
        <DialogHost />
      </body>
    </html>
  );
}
