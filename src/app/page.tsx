import Link from 'next/link';

export default function Inicio() {
  return (
    <section className="hero">
      <div className="wrap">
        <div>
          <p className="label">Oficina especializada em motos e scooter · Praia Grande/SP</p>
          <h1>Sua scooter nas mãos de <em>quem é especialista</em></h1>
          <p className="lead">Conte o que a moto está apresentando, acompanhe cada etapa pelo número de protocolo e escolha o melhor horário. A oficina confirma o agendamento depois de avaliar o pedido.</p>
          <div className="row cta">
            <Link className="btn primary" href="/cliente/nova">Solicitar manutenção</Link>
            <Link className="btn" href="/cliente">Acompanhar meu pedido</Link>
          </div>
        </div>
        <div className="stack" style={{ alignItems: 'center' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="hero-logo" src="/logo.png" alt="Logotipo Master Scooter Motos" width={150} height={150} />
          <p className="small muted">Av. Hugo de Carvalho Ramos, 50 · Praia Grande/SP<br />Seg a sex 8h às 18h · Sáb 8h às 14h</p>
        </div>
      </div>
    </section>
  );
}
