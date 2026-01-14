import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Corrales Bosque Gallery - Inventory Portal',
  description: 'Inventory management for Corrales Bosque Gallery artists',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
