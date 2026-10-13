import Link from 'next/link';
import { equipeAtual } from '@/lib/equipe';
import { PESO_PRIORIDADE, PRIORIDADE, STATUS, classeStatus, dataHora, hojeSP, inicioDoDia, somarDias } from '@/lib/rotulos';
import { NavPainel } from './navegacao';

export const metadata = { title: 'Painel da oficina' };

const FILTROS = {
  abertas: { nome: 'Abertas', status: null },
  novas: { nome: 'Novas', status: ['recebida', 'aguardando_avaliacao'] },
  agendar: { nome: 'Para agendar', status: ['aguardando_agendamento'] },
  oficina: { nome: 'Na oficina', status: ['agendado', 'veiculo_recebido', 'em_manutencao', 'aguardando_aprovacao_orcamento'] },
  encerradas: { nome: 'Encerradas', status: ['concluido', 'cancelado'] },
} as const;
type Filtro = keyof typeof FILTROS;

type Linha = {
  id: string; protocolo: string; status: string; prioridade: string | null; sintoma_risco: boolean;
  preferencia_inicio: string | null; criado_em: string;
  clientes: { nome_completo: string } | null; veiculos: { modelo: string } | null; servicos: { nome: string } | null;
};

export default async function Painel({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, nome } = await equipeAtual();
  const sp = await searchParams;
  const filtro: Filtro = sp.f && sp.f in FILTROS ? (sp.f as Filtro) : 'abertas';
  const hoje = hojeSP();

  let consulta = supabase.from('solicitacoes')
    .select('id, protocolo, status, prioridade, sintoma_risco, preferencia_inicio, criado_em, clientes(nome_completo), veiculos(modelo), servicos(nome)')
    .order('criado_em', { ascending: false }).limit(200);
  const st = FILTROS[filtro].status;
  consulta = st ? consulta.in('status', [...st]) : consulta.not('status', 'in', '(concluido,cancelado)');

  const [{ data }, novas, agendar, deHoje] = await Promise.all([
    consulta,
    supabase.from('solicitacoes').select('id', { count: 'exact', head: true }).in('status', ['recebida', 'aguardando_avaliacao']),
    supabase.from('solicitacoes').select('id', { count: 'exact', head: true }).eq('status', 'aguardando_agendamento'),
    supabase.from('agendamentos').select('id', { count: 'exact', head: true }).eq('estado', 'confirmado')
      .gte('inicio', inicioDoDia(hoje)).lt('inicio', inicioDoDia(somarDias(hoje, 1))),
  ]);

  // risco e prioridade primeiro; depois, as mais antigas esperando
  const linhas = ((data ?? []) as unknown as Linha[]).sort((a, b) =>
    Number(b.sintoma_risco) - Number(a.sintoma_risco)
    || (PESO_PRIORIDADE[b.prioridade ?? ''] ?? 0) - (PESO_PRIORIDADE[a.prioridade ?? ''] ?? 0)
    || (filtro === 'encerradas' ? b.criado_em.localeCompare(a.criado_em) : a.criado_em.localeCompare(b.criado_em)));

  return (
    <div className="wrap page">
      <NavPainel atual="solicitacoes" nome={nome} />
      <div className="kpis">
        <div className="kpi"><p className="label">Novas para avaliar</p><p className="v">{novas.count ?? 0}</p></div>
        <div className="kpi"><p className="label">Esperando horário</p><p className="v">{agendar.count ?? 0}</p></div>
        <div className="kpi"><p className="label">Agendadas hoje</p><p className="v">{deHoje.count ?? 0}</p></div>
      </div>
      <nav className="days" aria-label="Filtro" style={{ marginBottom: 12 }}>
        {(Object.keys(FILTROS) as Filtro[]).map((k) => (
          <Link key={k} className="day" href={k === 'abertas' ? '/painel' : `/painel?f=${k}`} aria-pressed={k === filtro}>{FILTROS[k].nome}</Link>
        ))}
      </nav>
      {linhas.length ? (
        <div className="list">
          {linhas.map((s) => (
            <Link key={s.id} className="item" href={`/painel/solicitacoes/${s.id}`} style={{ textDecoration: 'none' }}>
              <span className="top">
                <span className="mono">{s.protocolo}</span>
                <span className="row" style={{ gap: 6 }}>
                  {s.sintoma_risco && <span className="tag t-crit">Sintoma de risco</span>}
                  {s.prioridade && <span className={`tag p-${s.prioridade}`}>{PRIORIDADE[s.prioridade]}</span>}
                  <span className={`tag ${classeStatus(s.status)}`}>{STATUS[s.status]}</span>
                </span>
              </span>
              <span><b>{s.clientes?.nome_completo}</b> · {s.veiculos?.modelo} · {s.servicos?.nome ?? 'Avaliação'}</span>
              <span className="small muted">
                Recebida {dataHora(s.criado_em)}
                {s.preferencia_inicio && <> · <b>Cliente prefere {dataHora(s.preferencia_inicio)}</b></>}
              </span>
            </Link>
          ))}
        </div>
      ) : <p className="panel muted">Nenhuma solicitação neste filtro.</p>}
    </div>
  );
}
