import Link from 'next/link';
import { cookies, headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { equipeAtual } from '@/lib/equipe';
import { PRIORIDADE, STATUS, classeStatus, dataHora, diaCurto, hojeSP, hora, somarDias, telefoneBR } from '@/lib/rotulos';
import { cancelarAgendamento, confirmarAgendamento, gerarLinkAcompanhamento, revogarLinkAcompanhamento, salvarTriagem } from '../../actions';
import { Aviso, NavPainel } from '../../navegacao';

export const metadata = { title: 'Solicitação · Painel' };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> };

export default async function FichaSolicitacao({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, nome, admin, definePrioridade } = await equipeAtual();

  const { data: s } = await supabase.from('solicitacoes')
    .select('id, protocolo, status, prioridade, descricao, sintomas, inicio_problema, quilometragem, disponibilidade, sintoma_risco, tempo_estimado_min, preferencia_inicio, criado_em, clientes(nome_completo, telefone, email, preferencia_contato), veiculos(marca, modelo, ano, placa), servicos(slug, nome, duracao_minutos)')
    .eq('id', id).maybeSingle();
  if (!s) notFound();
  const cliente = s.clientes as unknown as { nome_completo: string; telefone: string; email: string | null; preferencia_contato: string } | null;
  const veiculo = s.veiculos as unknown as { marca: string; modelo: string; ano: number; placa: string | null } | null;
  const servico = s.servicos as unknown as { slug: string; nome: string; duracao_minutos: number } | null;

  const [{ data: eventos }, { data: notas }, { data: agendamento }, { data: servicos }, { data: sintomas }, { data: linkAtivo }] = await Promise.all([
    supabase.from('solicitacao_eventos').select('id, status_novo, descricao, visivel_cliente, criado_em').eq('solicitacao_id', id).order('id', { ascending: false }),
    supabase.from('notas_internas').select('id, texto, criado_em').eq('solicitacao_id', id).order('id', { ascending: false }),
    supabase.from('agendamentos').select('id, inicio, fim, recursos(nome)').eq('solicitacao_id', id).eq('estado', 'confirmado').maybeSingle(),
    supabase.from('servicos').select('slug, nome, duracao_minutos').eq('ativo', true).order('ordem'),
    supabase.from('sintomas').select('slug, texto, risco'),
    supabase.from('acessos_protocolo').select('expira_em').eq('solicitacao_id', id).is('revogado_em', null)
      .gt('expira_em', new Date().toISOString()).maybeSingle(),
  ]);
  // o link completo só existe aqui logo depois de gerado (cookie de 5 minutos); o banco guarda só o hash
  const tokenGerado = (await cookies()).get(`ms_link_${id}`)?.value;
  const h = await headers();
  const site = process.env.NEXT_PUBLIC_SITE_URL || `${h.get('x-forwarded-proto') ?? 'https'}://${h.get('host')}`;
  const linkGerado = tokenGerado ? `${site.replace(/\/$/, '')}/p/${tokenGerado}` : null;
  const textoSintoma = new Map((sintomas ?? []).map((x) => [x.slug, x]));
  const encerrada = s.status === 'concluido' || s.status === 'cancelado';

  // escolha de horário pela equipe: mesma vitrine do cliente, sem a etapa de preferência
  const podeAgendar = !agendamento && !encerrada;
  const hoje = hojeSP();
  const dias = Array.from({ length: 14 }, (_, i) => somarDias(hoje, i));
  const dia = sp.dia && dias.includes(sp.dia) ? sp.dia : dias[0];
  const { data: horarios } = podeAgendar
    ? await supabase.rpc('horarios_disponiveis', { p_data: dia, p_servico_slug: servico?.slug ?? '' })
    : { data: null };

  return (
    <div className="wrap page">
      <NavPainel atual="solicitacoes" nome={nome} admin={admin} />
      <p className="label"><Link href="/painel">Solicitações</Link></p>
      <div className="row" style={{ justifyContent: 'space-between', margin: '8px 0 12px' }}>
        <h2 className="mono" style={{ margin: 0 }}>{s.protocolo}</h2>
        <span className="row" style={{ gap: 6 }}>
          {s.prioridade && <span className={`tag p-${s.prioridade}`}>{PRIORIDADE[s.prioridade]}</span>}
          <span className={`tag ${classeStatus(s.status)}`}>{STATUS[s.status]}</span>
        </span>
      </div>
      <Aviso ok={sp.ok} erro={sp.erro} />

      <div className="cols" style={{ marginTop: 12 }}>
        <div className="stack">
          {s.sintoma_risco && <div className="note crit">Cliente relatou sintoma de risco. Ele já recebeu a orientação de evitar rodar com a moto.</div>}
          <div className="panel stack">
            <p className="label">Cliente</p>
            <p><b>{cliente?.nome_completo}</b><br />
              <span className="mono">{cliente ? telefoneBR(cliente.telefone) : ''}</span>{cliente?.email && <> · {cliente.email}</>}<br />
              <span className="small muted">Prefere contato por {cliente?.preferencia_contato}</span></p>
            <p className="label">Scooter</p>
            <p>{veiculo?.marca} {veiculo?.modelo} · {veiculo?.ano}{veiculo?.placa && <> · <span className="mono">{veiculo.placa}</span></>}<br />
              <span className="small mono">{Number(s.quilometragem).toLocaleString('pt-BR')} km</span></p>
            <p className="label">Relato</p>
            <p>{s.descricao}</p>
            {s.sintomas?.length > 0 && (
              <div className="row" style={{ gap: 6 }}>
                {s.sintomas.map((x: string) => <span key={x} className={`tag ${textoSintoma.get(x)?.risco ? 't-crit' : ''}`}>{textoSintoma.get(x)?.texto ?? x}</span>)}
              </div>
            )}
            <dl className="small" style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', margin: 0 }}>
              <dt className="muted">Serviço pedido</dt><dd style={{ margin: 0 }}>{servico?.nome ?? 'Avaliação'}</dd>
              {s.inicio_problema && <><dt className="muted">Começou</dt><dd style={{ margin: 0 }}>{s.inicio_problema}</dd></>}
              {s.disponibilidade && <><dt className="muted">Disponibilidade</dt><dd style={{ margin: 0 }}>{s.disponibilidade}</dd></>}
              <dt className="muted">Recebida</dt><dd style={{ margin: 0 }}>{dataHora(s.criado_em)}</dd>
            </dl>
          </div>

          <div className="panel">
            <p className="label" style={{ marginBottom: 8 }}>Andamento</p>
            <ol className="timeline">
              {eventos?.map((e) => (
                <li key={e.id}><b>{STATUS[e.status_novo]}</b> <span className="muted small">· {dataHora(e.criado_em)}{!e.visivel_cliente && ' · só equipe'}</span>
                  {e.descricao && <><br /><span className="small">{e.descricao}</span></>}</li>
              ))}
            </ol>
          </div>
        </div>

        <div className="stack">
          <form action={salvarTriagem} className="panel stack">
            <p className="label">Triagem</p>
            <input type="hidden" name="solicitacaoId" value={s.id} />
            <input type="hidden" name="prioridadeAtual" value={s.prioridade ?? ''} />
            <div className="grid2">
              <label className="f">Situação
                <select name="status" defaultValue={s.status}>
                  {Object.entries(STATUS).filter(([k]) => k !== 'agendado' || s.status === 'agendado')
                    .map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              <label className="f">Prioridade
                <select name="prioridade" defaultValue={s.prioridade ?? ''} disabled={!definePrioridade}>
                  <option value="">Não definida</option>
                  {Object.entries(PRIORIDADE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
            </div>
            {!definePrioridade && <p className="small muted">Só o especialista ou o administrador define a prioridade.</p>}
            <div className="grid2">
              <label className="f">Serviço
                <select name="servico" defaultValue={servico?.slug ?? ''}>
                  <option value="">Avaliação</option>
                  {servicos?.map((x) => <option key={x.slug} value={x.slug}>{x.nome} ({x.duracao_minutos} min)</option>)}
                </select>
              </label>
              <label className="f">Tempo estimado (min)<input name="tempoEstimado" inputMode="numeric" defaultValue={s.tempo_estimado_min ?? ''} /></label>
            </div>
            <label className="f">Nota interna (o cliente não vê)<textarea name="nota" rows={3} maxLength={2000} /></label>
            <div><button className="btn primary" type="submit">Salvar triagem</button></div>
            <p className="small muted">Para marcar como agendado, confirme um horário abaixo.</p>
          </form>

          <div className="panel stack">
            <p className="label">Agendamento</p>
            {agendamento ? (
              <>
                <div className="note ok"><b>Confirmado:</b> {dataHora(agendamento.inicio)} às {hora(agendamento.fim)} · {(agendamento.recursos as unknown as { nome: string } | null)?.nome}</div>
                <form action={cancelarAgendamento} className="stack">
                  <input type="hidden" name="agendamentoId" value={agendamento.id} />
                  <input type="hidden" name="solicitacaoId" value={s.id} />
                  <label className="f">Motivo do cancelamento<input name="motivo" maxLength={200} required /></label>
                  <div><button className="btn" type="submit">Cancelar agendamento</button></div>
                </form>
              </>
            ) : encerrada ? <p className="small muted">Solicitação encerrada.</p> : (
              <>
                {s.preferencia_inicio && (
                  <form action={confirmarAgendamento} className="note">
                    <input type="hidden" name="solicitacaoId" value={s.id} />
                    <p style={{ margin: '0 0 8px' }}><b>Cliente prefere:</b> {dataHora(s.preferencia_inicio)}</p>
                    <button className="btn primary small" type="submit" name="inicio" value={new Date(s.preferencia_inicio).toISOString()}>Confirmar esse horário</button>
                  </form>
                )}
                <p className="small">Ou escolha outro horário ({servico?.duracao_minutos ?? 60} min):</p>
                <nav className="days" aria-label="Dias">
                  {dias.map((d) => <Link key={d} className="day" aria-pressed={d === dia} href={`?dia=${d}`} scroll={false}>{diaCurto(d)}</Link>)}
                </nav>
                {horarios?.length ? (
                  <form action={confirmarAgendamento} className="slots">
                    <input type="hidden" name="solicitacaoId" value={s.id} />
                    {horarios.map((h: { inicio: string }) => (
                      <button key={h.inicio} className="slot" type="submit" name="inicio" value={new Date(h.inicio).toISOString()}>{hora(h.inicio)}</button>
                    ))}
                  </form>
                ) : <p className="small muted">Sem horários livres neste dia.</p>}
                <p className="small muted">Ao confirmar, o banco revalida box, expediente, bloqueios e capacidade do dia.</p>
              </>
            )}
          </div>

          <div className="panel stack">
            <p className="label">Link de acompanhamento</p>
            <p className="small">Para o cliente acompanhar sem fazer login. Mostra só a situação e as datas, sem nome, telefone ou placa.</p>
            {linkGerado ? (
              <div className="note ok stack"><span className="small">Copie agora. Por segurança, o link completo não aparece de novo.</span>
                <span className="link-gerado">{linkGerado}</span></div>
            ) : linkAtivo ? (
              <p className="small">Há um link ativo até {dataHora(linkAtivo.expira_em)}.</p>
            ) : <p className="small muted">Nenhum link ativo.</p>}
            <div className="row">
              <form action={gerarLinkAcompanhamento} className="inline">
                <input type="hidden" name="solicitacaoId" value={s.id} />
                <button className="btn small" type="submit">{linkAtivo ? 'Gerar novo link' : 'Gerar link'}</button>
              </form>
              {linkAtivo && (
                <form action={revogarLinkAcompanhamento} className="inline">
                  <input type="hidden" name="solicitacaoId" value={s.id} />
                  <button className="btn small" type="submit">Desativar link</button>
                </form>
              )}
            </div>
            {linkAtivo && !linkGerado && <p className="small muted">Gerar um novo link desativa o anterior.</p>}
          </div>

          {notas?.length ? (
            <div className="panel stack">
              <p className="label">Notas internas</p>
              {notas.map((n) => <p key={n.id} className="small"><span className="muted">{dataHora(n.criado_em)}</span><br />{n.texto}</p>)}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
