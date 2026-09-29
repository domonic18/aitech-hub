/** 公开站壳(M1 占位:Header/Footer 随 M3 落地) */
export default function SiteLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <div className="mx-auto min-h-screen max-w-3xl px-4 py-12">{children}</div>;
}
