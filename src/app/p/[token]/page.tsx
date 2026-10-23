import type { Metadata } from 'next';
import { supabaseServidor } from '@/lib/supabase/server';
import { STATUS, classeStatus, dataHora } from '@/lib/rotulos';
import { tokenProtocoloSchema } from '@/lib/validacao';

// Link pessoal: fora dos buscadores e sem repassar o endereço para outros sites
export const metadata: Metadata = { title: 'Acompanhamento', robots: { index: false, follow: false }, referrer: 'no-referrer' };
export const dynamic = 'force-dynamic';

type Andamento = {
  protocolo: string; status: string; criado_em: string; moto: string | null; servico: string | null; agendamento: string | null;
  eventos: { quando: string; descricao: string; status: string }[];
};

// Acompanhamento sem login: o cliente recebe o link da oficina. A página mostra só o andamento,
// sem nome, telefone ou placa, porque o link pode ser repassado.
export default async function Acompanhamento({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let andamento: Andamento | null = null;
  if (tokenProtocoloSchema.safeParse(token).success) {
    const supabase = await supabaseServidor();
    const { data } = await supabase.rpc('consultar_protocolo', { p_token: token });
    andamento = (data as Andamento | null) ?? null;
  }

  if (!andamento) {
    return (
      <div className="wrap page" style={{ maxWidth: 560 }}>
        <div className="panel stack">
          <p className="label">Acompanhamento</p>
          <h2 style={{ margin: 0 }}>Link inválido ou expirado</h2>
          <p>Peça um novo link à oficina. Se você tem cadastro, também pode acompanhar pela área do cliente.</p>
          <div><a className="btn primary" href="/entrar">Entrar</a></div>
        </div>
      </div>
    );
  }

  return (
    <div className="wrap page" style={{ maxWidth: 720 }}>
      <p className="label">Acompanhamento</p>
      <div className="row" style={{ justifyContent: 'space-between', margin: '8px 0 12px' }}>
        <h2 className="mono" style={{ margin: 0 }}>{andamento.protocolo}</h2>
        <span className={`tag ${classeStatus(andamento.status)}`}>{STATUS[andamento.status] ?? andamento.status}</span>
      </div>
      <div className="panel stack">
        <dl className="small" style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', margin: 0 }}>
          {andamento.moto && <><dt className="muted">Scooter</dt><dd style={{ margin: 0 }}>{andamento.moto}</dd></>}
          <dt className="muted">Serviço</dt><dd style={{ margin: 0 }}>{andamento.servico ?? 'Avaliação'}</dd>
          <dt className="muted">Aberta em</dt><dd style={{ margin: 0 }}>{dataHora(andamento.criado_em)}</dd>
          {andamento.agendamento && <><dt className="muted">Horário marcado</dt><dd style={{ margin: 0 }}><b>{dataHora(andamento.agendamento)}</b></dd></>}
        </dl>
      </div>
      <div className="panel" style={{ marginTop: 12 }}>
        <p className="label" style={{ marginBottom: 8 }}>Andamento</p>
        <ol className="timeline">
          {[...andamento.eventos].reverse().map((e, i) => (
            <li key={i}><b>{STATUS[e.status] ?? e.status}</b> <span className="muted small">· {dataHora(e.quando)}</span>
              {e.descricao && <><br /><span className="small">{e.descricao}</span></>}</li>
          ))}
        </ol>
      </div>
      <p className="small muted" style={{ marginTop: 12 }}>Este link é pessoal e vale por 30 dias. Não compartilhe. Dúvidas sobre valores e detalhes do serviço são tratadas direto com a oficina.</p>
    </div>
  );
}
