import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Master Scooter Motos', template: '%s · Master Scooter Motos' },
  description: 'Oficina especializada em motos e scooter em Praia Grande/SP. Solicite manutenção e acompanhe seu pedido.',
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };

const producao = process.env.NEXT_PUBLIC_AMBIENTE === 'producao';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@0,600;0,700;1,700;1,800&family=IBM+Plex+Mono:wght@500&family=IBM+Plex+Sans:wght@400;500;600&display=swap" />
      </head>
      <body>
        {!producao && (
          <div className="ambiente" role="note"><div className="wrap"><b>AMBIENTE DE TESTES</b> · use apenas dados fictícios</div></div>
        )}
        <header className="top">
          <div className="wrap">
            <Link className="brand" href="/">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.png" alt="Logotipo Master Scooter Motos" width={40} height={40} />
              Master <span>Scooter</span>
            </Link>
            <nav className="nav-links" aria-label="Principal">
              <Link href="/">Início</Link>
              <Link href="/cliente">Área do cliente</Link>
            </nav>
          </div>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
