import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/contexts/AuthContext";
import { HyperliquidWSProvider } from "@/contexts/HyperliquidWSContext";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "HyperliquidSentry",
  description: "Real-time Hyperliquid trading intelligence platform",
};

import { Providers } from './providers';
import { SidebarProvider } from '@/contexts/SidebarContext';

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        suppressHydrationWarning
      >
        <Providers>
          <AuthProvider>
            <SidebarProvider>
              <HyperliquidWSProvider>
                {children}
              </HyperliquidWSProvider>
            </SidebarProvider>
          </AuthProvider>
        </Providers>
      </body>
    </html>
  );
}
