import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { supabaseServidor } from '@/lib/supabase/server';
import { STATUS, classeStatus, dataHora, diaCurto, hojeSP, hora, somarDias } from '@/lib/rotulos';
import { indicarPreferencia } from '../../actions';
import { Anexos } from '@/components/anexos';
import { listarAnexos } from '@/lib/anexos';

export const metadata = { title: 'Solicitação' };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> };

export default async function Solicitacao({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const supabase = await supabaseServidor();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/entrar');

  const { data: s } = await supabase.from('solicitacoes')
    .select('id, protocolo, status, descricao, sintoma_risco, preferencia_inicio, criado_em, servicos(slug, nome), veiculos(marca, modelo)')
    .eq('id', id).maybeSingle();
  if (!s) notFound();
  const servico = s.servicos as unknown as { slug: string; nome: string } | null;
  const [{ data: eventos }, { data: agendamento }, anexos] = await Promise.all([
    supabase.from('solicitacao_eventos').select('id, status_novo, descricao, criado_em').eq('solicitacao_id', id).order('id', { ascending: false }),
    supabase.from('agendamentos').select('inicio').eq('solicitacao_id', id).eq('estado', 'confirmado').maybeSingle(),
    listarAnexos(supabase, id),
  ]);

  // escolha de horário: só depois da avaliação e enquanto não houver preferência pendente
  const podeEscolher = s.status === 'aguardando_agendamento' && !s.preferencia_inicio && !agendamento;
  const hoje = hojeSP();
  const dias = Array.from({ length: 14 }, (_, i) => somarDias(hoje, i));
  const dia = sp.dia && dias.includes(sp.dia) ? sp.dia : dias[1];
  const { data: horarios } = podeEscolher
    ? await supabase.rpc('horarios_disponiveis', { p_data: dia, p_servico_slug: servico?.slug ?? '' })
    : { data: null };
  const inicioAgendado: string | null = agendamento?.inicio ?? null;

  return (
    <div className="wrap page" style={{ maxWidth: 820 }}>
      <p className="label"><Link href="/cliente">Área do cliente</Link></p>
      <div className="panel stack" style={{ marginTop: 8 }}>
        {sp.nova && <div className="ok-box">Solicitação registrada. Guarde o protocolo <b className="mono">{s.protocolo}</b>.</div>}
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="mono" style={{ fontSize: '1.1rem' }}>{s.protocolo}</span>
          <span className={`tag ${classeStatus(s.status)}`}>{STATUS[s.status]}</span>
        </div>
        {s.sintoma_risco && <div className="note crit">Você relatou um sintoma que pode afetar a segurança. Por precaução, evite rodar com a moto até receber orientação da oficina.</div>}
        <p className="small muted">{(s.veiculos as unknown as { marca: string; modelo: string } | null)?.modelo} · {servico?.nome ?? 'Avaliação'}</p>
        <p>{s.descricao}</p>

        {sp.erro && <p className="err" role="alert">{sp.erro}</p>}
        {inicioAgendado && <div className="note ok"><b>Agendamento confirmado:</b> {dataHora(inicioAgendado)}. Leve a scooter nesse horário.</div>}
        {s.preferencia_inicio && !agendamento && <div className="note"><b>Preferência enviada:</b> {dataHora(s.preferencia_inicio)}. Aguardando confirmação da oficina.</div>}
        {['recebida', 'aguardando_avaliacao', 'aguardando_aprovacao_especialista'].includes(s.status) &&
          <p className="small muted">Assim que o especialista avaliar seu pedido, você poderá escolher um horário.</p>}

        {podeEscolher && (
          <div className="stack">
            <p className="label">Escolha sua preferência de horário</p>
            <nav className="days" aria-label="Dias">
              {dias.map((d) => (
                <Link key={d} className="day" aria-pressed={d === dia} href={`?dia=${d}`} scroll={false}>{diaCurto(d)}</Link>
              ))}
            </nav>
            {horarios?.length ? (
              <form action={indicarPreferencia} className="slots">
                <input type="hidden" name="solicitacaoId" value={s.id} />
                {horarios.map((h: { inicio: string }) => (
                  <button key={h.inicio} className="slot" type="submit" name="inicio" value={new Date(h.inicio).toISOString()}>{hora(h.inicio)}</button>
                ))}
              </form>
            ) : <p className="small muted">Sem horários livres neste dia.</p>}
            <p className="small muted">Só aparecem horários com box livre dentro do expediente. A oficina ainda precisa confirmar.</p>
          </div>
        )}

        <Anexos solicitacaoId={s.id} anexos={anexos} podeEnviar={!['concluido', 'cancelado'].includes(s.status)} />

        <div>
          <p className="label" style={{ marginBottom: 8 }}>Andamento</p>
          <ol className="timeline">
            {eventos?.map((e) => (
              <li key={e.id}><b>{STATUS[e.status_novo]}</b> <span className="muted small">· {dataHora(e.criado_em)}</span>{e.descricao && <><br /><span className="small">{e.descricao}</span></>}</li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
