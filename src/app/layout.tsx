import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'IAvid — Content Factory',
  description:
    'Usine à contenu vertical self-hosted : idée → script → assets → voix → montage → export 1080×1920.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <body className="min-h-screen bg-background">{children}</body>
    </html>
  );
}
