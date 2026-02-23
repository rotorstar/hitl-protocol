export const metadata = {
  title: 'HITL Reference Service',
  description: 'HITL Protocol v0.6 reference implementation (Next.js)',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
