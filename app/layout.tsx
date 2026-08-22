import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL('https://supplyshift-ai-command.aarushi-seth-0175.chatgpt.site'),
  title: 'SupplyShift — Player vs AI Year Challenge',
  description: 'A colorful real-time supply chain game: forecast demand, allocate three products across three regions, and beat the AI on year-end profit.',
  openGraph: {
    title: 'SupplyShift — Player vs AI Year Challenge',
    description: 'Orders never stop. Forecast demand, plan inventory monthly, and compete against an adaptive AI ensemble.',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'SupplyShift Player vs AI Year Challenge' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'SupplyShift — Player vs AI Year Challenge',
    description: 'Orders never stop. Forecast demand, plan inventory monthly, and compete against an adaptive AI ensemble.',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
