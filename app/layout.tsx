export const metadata = {
  title: 'CEDIS Tijuana',
  description: 'Sistema de Control de Operaciones',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  )
}
