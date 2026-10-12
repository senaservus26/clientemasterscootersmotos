import Link from 'next/link';
import { redirect } from 'next/navigation';
import { supabaseServidor } from '@/lib/supabase/server';
import { STATUS, classeStatus, dataHora } from '@/lib/rotulos';
import { CadastroForm, VeiculoForm } from './formularios';

export const metadata = { title: 'Área do cliente' };

export default async function AreaCliente({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const supabase = await supabaseServidor();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/entrar');

  const { data: cliente } = await supabase.from('clientes').select('id, nome_completo').eq('perfil_id', user.id).maybeSingle();
  if (!cliente) {
    const sp = await searchParams;
    const utm = Object.fromEntries(['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'].flatMap((k) => (sp[k] ? [[k, sp[k]!]] : [])));
    return <div className="wrap page" style={{ maxWidth: 760 }}><CadastroForm utm={utm} /></div>;
  }

  const [{ data: veiculos }, { data: solicitacoes }] = await Promise.all([
    supabase.from('veiculos').select('id, marca, modelo, ano, quilometragem').order('criado_em'),
    supabase.from('solicitacoes').select('id, protocolo, status, sintoma_risco, criado_em, veiculos(marca, modelo)').order('criado_em', { ascending: false }),
  ]);

  return (
    <div className="wrap page">
      <div className="page-head">
        <div><p className="label">Área do cliente</p><h2>Olá, {cliente.nome_completo.split(' ')[0]}</h2></div>
        <div className="row">
          {veiculos?.length ? <Link className="btn primary" href="/cliente/nova">Nova solicitação</Link> : null}
          <form className="inline" action="/auth/sair" method="post"><button className="btn small" type="submit">Sair</button></form>
        </div>
      </div>
      <div className="cols">
        <div className="stack">
          <p className="label">Minhas solicitações</p>
          {solicitacoes?.length ? (
            <div className="list">
              {solicitacoes.map((s) => (
                <Link key={s.id} className="item" href={`/cliente/solicitacoes/${s.id}`} style={{ textDecoration: 'none' }}>
                  <span className="top"><span className="mono">{s.protocolo}</span><span className={`tag ${classeStatus(s.status)}`}>{STATUS[s.status]}</span></span>
                  <span className="small">{(s.veiculos as unknown as { marca: string; modelo: string } | null)?.modelo} · {dataHora(s.criado_em)}</span>
                  {s.sintoma_risco && <span className="tag t-crit">Sintoma de risco relatado</span>}
                </Link>
              ))}
            </div>
          ) : <p className="panel muted">Nenhuma solicitação ainda.{veiculos?.length ? '' : ' Cadastre sua scooter para começar.'}</p>}
        </div>
        <div className="stack">
          <p className="label">Minhas scooters</p>
          {veiculos?.map((v) => (
            <div key={v.id} className="panel"><h3>{v.marca} {v.modelo}</h3><p className="small mono">{v.ano} · {Number(v.quilometragem).toLocaleString('pt-BR')} km</p></div>
          ))}
          <VeiculoForm />
        </div>
      </div>
    </div>
  );
}
