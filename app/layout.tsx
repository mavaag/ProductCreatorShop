import "./globals.css";
import Link from "next/link";

export const metadata = {
  title: "3D-shop productbeheer",
  description: "Producten, prijsberekening en WooCommerce-export",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl">
      <body>
        <nav className="topnav">
          <Link href="/products" className="brand">3D-shop beheer</Link>
          <div className="navlinks">
            <Link href="/products">Producten</Link>
            <Link href="/machines">Machines</Link>
            <Link href="/materials">Materialen</Link>
          </div>
        </nav>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
