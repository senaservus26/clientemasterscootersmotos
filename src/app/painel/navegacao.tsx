import Link from 'next/link';

export function NavPainel({ atual, nome }: { atual: 'solicitacoes' | 'agenda'; nome: string }) {
  return (
    <div className="page-head">
      <div><p className="label">Painel da oficina</p><h2>Olá, {nome.split(' ')[0]}</h2></div>
      <div className="row">
        <nav className="modes" aria-label="Painel">
          <Link href="/painel" aria-current={atual === 'solicitacoes' ? 'page' : undefined}>Solicitações</Link>
          <Link href="/painel/agenda" aria-current={atual === 'agenda' ? 'page' : undefined}>Agenda</Link>
        </nav>
        <form className="inline" action="/auth/sair" method="post"><button className="btn small" type="submit">Sair</button></form>
      </div>
    </div>
  );
}

export function Aviso({ ok, erro }: { ok?: string; erro?: string }) {
  if (erro) return <p className="err" role="alert">{erro}</p>;
  if (ok) return <p className="ok-box small" role="status">{ok}</p>;
  return null;
}
