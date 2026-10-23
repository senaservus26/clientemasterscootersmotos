export const metadata = { title: 'Acesso desativado', robots: { index: false } };

// Para quem tem login mas teve o acesso desativado pelo administrador. Evita o vaivém entre painel e área do cliente.
export default function SemAcesso() {
  return (
    <div className="wrap page" style={{ maxWidth: 560 }}>
      <div className="panel stack">
        <p className="label">Acesso desativado</p>
        <h2 style={{ margin: 0 }}>Seu acesso está desativado</h2>
        <p>O administrador da oficina desativou este acesso. Se achar que é um engano, fale com a oficina.</p>
        <div className="row">
          <form className="inline" action="/auth/sair" method="post"><button className="btn" type="submit">Sair</button></form>
        </div>
      </div>
    </div>
  );
}
