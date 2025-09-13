import type { Metadata } from "next";
import "./globals.css";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
  title: "RGM LLC - Real Estate Investment Solutions",
  description: "Professional real estate investment and management services. Discover premium investment opportunities and expert property management solutions.",
  keywords: "real estate, investment, property management, RGM, real estate solutions",
  robots: "index, follow",
  openGraph: {
    title: "RGM LLC - Real Estate Investment Solutions",
    description: "Professional real estate investment and management services. Discover premium investment opportunities and expert property management solutions.",
    type: "website",
    locale: "en_US",
    url: "https://rgmsllc.com",
  },
  twitter: {
    card: "summary_large_image",
    title: "RGM LLC - Real Estate Investment Solutions",
    description: "Professional real estate investment and management services. Discover premium investment opportunities and expert property management solutions.",
  }
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="canonical" href="https://rgmsllc.com" />
      </head>
      <body className="font-sans antialiased">
        <Header />
        {children}
        <Footer />
      </body>
    </html>
  );
}
