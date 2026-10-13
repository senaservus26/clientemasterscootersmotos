import Link from 'next/link';
import { equipeAtual } from '@/lib/equipe';
import { dataHora, diaCurto, hojeSP, hora, inicioDoDia, somarDias } from '@/lib/rotulos';
import { criarBloqueio, removerBloqueio } from '../actions';
import { Aviso, NavPainel } from '../navegacao';

export const metadata = { title: 'Agenda · Painel' };

type Ag = {
  id: string; inicio: string; fim: string; recurso_id: string;
  solicitacoes: { id: string; protocolo: string; clientes: { nome_completo: string } | null; veiculos: { modelo: string } | null; servicos: { nome: string } | null } | null;
};
type Bl = { id: string; recurso_id: string | null; periodo: string; motivo: string };

// "[2026-10-13 08:00:00-03,2026-10-13 12:00:00-03)" -> horários de início e fim
function limites(periodo: string): [string, string] {
  const [a, b] = periodo.replace(/^[[(]|[\])]$/g, '').split(',').map((x) => x.replace(/"/g, '').trim().replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'));
  return [a, b];
}

export default async function Agenda({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, nome } = await equipeAtual();
  const sp = await searchParams;
  const hoje = hojeSP();
  const dia = sp.dia && /^\d{4}-\d{2}-\d{2}$/.test(sp.dia) ? sp.dia : hoje;
  const ini = inicioDoDia(dia), fim = inicioDoDia(somarDias(dia, 1));
  const dias = Array.from({ length: 14 }, (_, i) => somarDias(hoje, i));
  const diaSemana = new Date(dia + 'T12:00:00Z').getUTCDay();

  const [{ data: recursos }, { data: ags }, { data: bls }, { data: prefs }, { data: expediente }, { data: cap }, { data: cfg }] = await Promise.all([
    supabase.from('recursos').select('id, nome').eq('ativo', true).order('nome'),
    supabase.from('agendamentos').select('id, inicio, fim, recurso_id, solicitacoes(id, protocolo, clientes(nome_completo), veiculos(modelo), servicos(nome))')
      .eq('estado', 'confirmado').gte('inicio', ini).lt('inicio', fim).order('inicio'),
    supabase.from('bloqueios').select('id, recurso_id, periodo, motivo').overlaps('periodo', `[${ini},${fim})`),
    supabase.from('solicitacoes').select('id, protocolo, preferencia_inicio, clientes(nome_completo)')
      .gte('preferencia_inicio', ini).lt('preferencia_inicio', fim).eq('status', 'aguardando_agendamento').order('preferencia_inicio'),
    supabase.from('horarios_funcionamento').select('abre, fecha').eq('dia_semana', diaSemana),
    supabase.from('capacidade_diaria').select('limite').eq('dia_semana', diaSemana).maybeSingle(),
    supabase.from('configuracao').select('capacidade_diaria_padrao').maybeSingle(),
  ]);
  const agendamentos = (ags ?? []) as unknown as Ag[];
  const bloqueios = (bls ?? []) as Bl[];
  const limite = cap?.limite ?? cfg?.capacidade_diaria_padrao ?? 0;
  const nomeRecurso = new Map((recursos ?? []).map((r) => [r.id, r.nome]));

  const horas: number[] = [];
  for (const e of expediente ?? []) {
    for (let h = Number(e.abre.slice(0, 2)); h < Number(e.fecha.slice(0, 2)); h++) horas.push(h);
  }
  const horaSP = (iso: string) => Number(hora(iso).slice(0, 2));
  // o bloqueio ocupa alguma parte da hora h deste dia?
  const base = new Date(ini).getTime();
  const cobre = (b: Bl, h: number) => {
    const [a, z] = limites(b.periodo).map((x) => new Date(x).getTime());
    return a < base + (h + 1) * 3600e3 && z > base + h * 3600e3;
  };

  return (
    <div className="wrap page">
      <NavPainel atual="agenda" nome={nome} />
      <nav className="days" aria-label="Dias" style={{ marginBottom: 12 }}>
        {dias.map((d) => <Link key={d} className="day" aria-pressed={d === dia} href={`?dia=${d}`} scroll={false}>{diaCurto(d)}</Link>)}
      </nav>
      <Aviso ok={sp.ok} erro={sp.erro} />
      <div className="kpis" style={{ marginTop: 12 }}>
        <div className="kpi"><p className="label">Ocupação do dia</p><p className="v">{agendamentos.length}<span className="small muted"> / {limite}</span></p>
          <div className="bar" style={{ marginTop: 8 }}><i style={{ width: `${limite ? Math.min(100, (agendamentos.length / limite) * 100) : 0}%` }} /></div></div>
        <div className="kpi"><p className="label">Preferências a confirmar</p><p className="v">{prefs?.length ?? 0}</p></div>
      </div>

      {horas.length === 0 ? <p className="panel muted">Oficina fechada neste dia.</p> : (
        <div className="scroll panel" style={{ padding: 0 }}>
          <table className="ag">
            <thead><tr><th>Hora</th>{recursos?.map((r) => <th key={r.id}>{r.nome}</th>)}</tr></thead>
            <tbody>
              {horas.map((h) => (
                <tr key={h}>
                  <td className="h">{String(h).padStart(2, '0')}:00</td>
                  {recursos?.map((r) => (
                    <td key={r.id}>
                      {agendamentos.filter((a) => a.recurso_id === r.id && horaSP(a.inicio) === h).map((a) => (
                        <Link key={a.id} className="ev conf" style={{ display: 'block', textDecoration: 'none', color: 'inherit' }} href={`/painel/solicitacoes/${a.solicitacoes?.id}`}>
                          <b>{hora(a.inicio)}–{hora(a.fim)}</b> {a.solicitacoes?.clientes?.nome_completo}<br />
                          <span className="small">{a.solicitacoes?.veiculos?.modelo} · {a.solicitacoes?.servicos?.nome ?? 'Avaliação'}</span>
                        </Link>
                      ))}
                      {bloqueios.filter((b) => (b.recurso_id === null || b.recurso_id === r.id) && cobre(b, h))
                        .map((b) => <div key={b.id} className="ev blk">Bloqueado · {b.motivo}</div>)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="cols" style={{ marginTop: 16 }}>
        <div className="stack">
          <p className="label">Preferências dos clientes neste dia</p>
          {prefs?.length ? prefs.map((p) => (
            <Link key={p.id} className="item" href={`/painel/solicitacoes/${p.id}`} style={{ textDecoration: 'none' }}>
              <span className="top"><span className="mono">{p.protocolo}</span><span className="tag t-wait">{hora(p.preferencia_inicio!)}</span></span>
              <span className="small">{(p.clientes as unknown as { nome_completo: string } | null)?.nome_completo}</span>
            </Link>
          )) : <p className="small muted">Nenhuma.</p>}

          <p className="label">Bloqueios neste dia</p>
          {bloqueios.length ? bloqueios.map((b) => {
            const [a, z] = limites(b.periodo);
            return (
              <form key={b.id} action={removerBloqueio} className="item">
                <input type="hidden" name="bloqueioId" value={b.id} /><input type="hidden" name="dia" value={dia} />
                <span className="top"><span>{b.recurso_id ? nomeRecurso.get(b.recurso_id) : 'Oficina inteira'} · {dataHora(a)} às {hora(z)}</span>
                  <button className="btn small" type="submit">Remover</button></span>
                <span className="small">{b.motivo}</span>
              </form>
            );
          }) : <p className="small muted">Nenhum.</p>}
        </div>

        <form action={criarBloqueio} className="panel stack">
          <p className="label">Bloquear horário</p>
          <div className="grid2">
            <label className="f">Data<input type="date" name="data" defaultValue={dia} required /></label>
            <label className="f">Onde
              <select name="recursoId" defaultValue="">
                <option value="">Oficina inteira</option>
                {recursos?.map((r) => <option key={r.id} value={r.id}>{r.nome}</option>)}
              </select>
            </label>
          </div>
          <div className="grid2">
            <label className="f">Das<input type="time" name="inicio" defaultValue="08:00" step={1800} required /></label>
            <label className="f">Até<input type="time" name="fim" defaultValue="12:00" step={1800} required /></label>
          </div>
          <label className="f">Motivo<input name="motivo" maxLength={200} placeholder="Ex.: feriado, manutenção do elevador" required /></label>
          <div><button className="btn primary" type="submit">Bloquear</button></div>
          <p className="small muted">Horários bloqueados somem da escolha do cliente na hora.</p>
        </form>
      </div>
    </div>
  );
}
