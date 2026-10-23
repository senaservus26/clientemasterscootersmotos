import Link from 'next/link';
import { notFound } from 'next/navigation';
import { equipeAtual } from '@/lib/equipe';
import { STATUS, classeStatus, dataHora, telefoneBR } from '@/lib/rotulos';
import { CANAIS_EQUIPE } from '@/lib/validacao';
import { SolicitacaoForm, VeiculoForm } from '@/app/cliente/formularios';
import { abrirSolicitacaoEquipe, salvarPreferenciasEquipe, salvarVeiculoEquipe, vincularLoginCliente } from '../../actions';
import { Aviso, NavPainel } from '../../navegacao';

export const metadata = { title: 'Cliente · Painel' };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> };
type Veiculo = {
  id: string; marca: string; modelo: string; ano: number; ano_modelo: number | null; quilometragem: number; placa: string | null;
  ultima_manutencao_em: string | null; historico_informado: string | null; observacoes: string | null;
};

const CANAL: Record<string, string> = { site: 'Site', ...CANAIS_EQUIPE };

export default async function FichaCliente({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, nome, admin } = await equipeAtual();
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();

  const { data: c } = await supabase.from('clientes')
    .select('id, nome_completo, telefone, email, preferencia_contato, perfil_id, canal_cadastro, criado_em, origens(canal)')
    .eq('id', id).maybeSingle();
  if (!c) notFound();

  const [{ data: veiculos }, { data: solicitacoes }, { data: consentimentos }, { data: servicos }, { data: sintomas }] = await Promise.all([
    supabase.from('veiculos').select('id, marca, modelo, ano, ano_modelo, quilometragem, placa, ultima_manutencao_em, historico_informado, observacoes')
      .eq('cliente_id', id).order('criado_em'),
    supabase.from('solicitacoes').select('id, protocolo, status, criado_em, veiculos(modelo)').eq('cliente_id', id).order('criado_em', { ascending: false }),
    supabase.from('consentimentos_atuais').select('tipo, aceito, canal, registrado_em').eq('cliente_id', id),
    supabase.from('servicos').select('slug, nome').eq('ativo', true).order('ordem'),
    supabase.from('sintomas').select('slug, texto, risco').eq('ativo', true).order('risco', { ascending: false }),
  ]);
  const consent = (tipo: string) => consentimentos?.find((x) => x.tipo === tipo);
  const motos = (veiculos ?? []) as Veiculo[];

  return (
    <div className="wrap page">
      <NavPainel atual="clientes" nome={nome} admin={admin} />
      <p className="label"><Link href="/painel/clientes">Clientes</Link></p>
      <h2 style={{ margin: '8px 0 12px' }}>{c.nome_completo}</h2>
      <Aviso ok={sp.ok} erro={sp.erro} />

      <div className="cols" style={{ marginTop: 12 }}>
        <div className="stack">
          <div className="panel stack">
            <p className="label">Contato</p>
            <p><span className="mono">{telefoneBR(c.telefone)}</span>{c.email && <> · {c.email}</>}<br />
              <span className="small muted">Prefere {c.preferencia_contato} · cadastro por {CANAL[c.canal_cadastro] ?? c.canal_cadastro} em {dataHora(c.criado_em)}
                {(c.origens as unknown as { canal: string } | null)?.canal && <> · conheceu por {(c.origens as unknown as { canal: string }).canal}</>}</span></p>
            <p className="small">{c.perfil_id ? 'Tem login no site e acompanha os pedidos pela área do cliente.' : 'Sem login no site. Para acompanhar, use o link de acompanhamento da solicitação.'}</p>
            {!c.perfil_id && (
              <form action={vincularLoginCliente} className="row">
                <input type="hidden" name="clienteId" value={c.id} />
                <input name="email" type="email" placeholder="E-mail que o cliente usou no site" aria-label="E-mail do login do cliente" style={{ flex: '1 1 220px' }} />
                <button className="btn small" type="submit">Ligar ao login</button>
              </form>
            )}
          </div>

          <form action={salvarPreferenciasEquipe} className="panel stack">
            <p className="label">Consentimentos</p>
            <input type="hidden" name="clienteId" value={c.id} />
            <p className="small">Aviso de privacidade: {consent('privacidade')?.aceito ? `informado em ${dataHora(consent('privacidade')!.registrado_em)}` : 'sem registro'}</p>
            <label className="check"><input type="checkbox" name="lembretes" defaultChecked={!!consent('lembretes')?.aceito} /> <span>Lembretes de manutenção</span></label>
            <label className="check"><input type="checkbox" name="marketing" defaultChecked={!!consent('marketing')?.aceito} /> <span>Novidades e promoções</span></label>
            <div className="row">
              <label className="f" style={{ flex: '0 1 180px' }}>Pedido feito por
                <select name="canal" defaultValue="balcao">{Object.entries(CANAIS_EQUIPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              </label>
              <button className="btn small" type="submit" style={{ alignSelf: 'flex-end' }}>Registrar mudança</button>
            </div>
            <p className="small muted">Só altere quando o próprio cliente pedir. Cada mudança fica no histórico.</p>
          </form>

          <div className="stack">
            <p className="label">Solicitações</p>
            {solicitacoes?.length ? (
              <div className="list">
                {solicitacoes.map((s) => (
                  <Link key={s.id} className="item" href={`/painel/solicitacoes/${s.id}`} style={{ textDecoration: 'none' }}>
                    <span className="top"><span className="mono">{s.protocolo}</span><span className={`tag ${classeStatus(s.status)}`}>{STATUS[s.status]}</span></span>
                    <span className="small">{(s.veiculos as unknown as { modelo: string } | null)?.modelo} · {dataHora(s.criado_em)}</span>
                  </Link>
                ))}
              </div>
            ) : <p className="small muted">Nenhuma solicitação ainda.</p>}
          </div>
        </div>

        <div className="stack">
          <p className="label">Motos</p>
          {motos.map((v) => (
            <div key={v.id} className="panel stack">
              <h3 style={{ margin: 0 }}>{v.marca} {v.modelo}</h3>
              <p className="small mono">{v.ano}{v.ano_modelo && v.ano_modelo !== v.ano ? `/${v.ano_modelo}` : ''} · {Number(v.quilometragem).toLocaleString('pt-BR')} km{v.placa ? ` · ${v.placa}` : ''}</p>
              {v.ultima_manutencao_em && <p className="small">Última manutenção: {new Date(v.ultima_manutencao_em + 'T12:00:00').toLocaleDateString('pt-BR')}</p>}
              {v.historico_informado && <p className="small"><b>Histórico informado:</b> {v.historico_informado}</p>}
              {v.observacoes && <p className="small"><b>Observações:</b> {v.observacoes}</p>}
            </div>
          ))}
          <VeiculoForm acao={salvarVeiculoEquipe} clienteId={c.id} />
          {motos.length > 0 && (
            <>
              <p className="label">Abrir solicitação para o cliente</p>
              <SolicitacaoForm acao={abrirSolicitacaoEquipe} clienteId={c.id}
                veiculos={motos.map((v) => ({ id: v.id, rotulo: `${v.marca} ${v.modelo} · ${v.ano}`, km: v.quilometragem }))}
                servicos={servicos ?? []} sintomas={sintomas ?? []} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
