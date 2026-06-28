// layout.tsx — המעטפת של כל האתר. מוגדר עברית מימין-לשמאל (RTL).
import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'מערכת ארכיון',
  description: 'מאגר פרטי, מאובטח ומנוהל',
  // אתר פרטי — מניעת אינדוקס בכל מנועי החיפוש (Google וכו').
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false },
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
