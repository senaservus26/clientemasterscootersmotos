import Link from 'next/link';
import { equipeAtual } from '@/lib/equipe';
import { dataHora, telefoneBR } from '@/lib/rotulos';
import { Aviso, NavPainel } from '../navegacao';

export const metadata = { title: 'Clientes · Painel' };

const CANAL: Record<string, string> = { site: 'Site', balcao: 'Balcão', telefone: 'Telefone', whatsapp: 'WhatsApp' };

export default async function Clientes({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, nome, admin } = await equipeAtual();
  const sp = await searchParams;
  // busca por nome ou telefone; só letras, números e espaços entram no filtro
  const busca = (sp.q ?? '').replace(/[^\p{L}\p{N} ]/gu, '').trim().slice(0, 60);
  const digitos = busca.replace(/\D/g, '');
  let consulta = supabase.from('clientes')
    .select('id, nome_completo, telefone, canal_cadastro, perfil_id, criado_em, veiculos(id)')
    .is('anonimizado_em', null).order('criado_em', { ascending: false }).limit(50);
  if (busca) {
    consulta = digitos.length >= 4 && digitos === busca.replace(/ /g, '')
      ? consulta.like('telefone', `%${digitos}%`)
      : consulta.ilike('nome_completo', `%${busca}%`);
  }
  const { data: clientes } = await consulta;

  return (
    <div className="wrap page">
      <NavPainel atual="clientes" nome={nome} admin={admin} />
      <Aviso erro={sp.erro} />
      <div className="row" style={{ justifyContent: 'space-between', margin: '8px 0 12px' }}>
        <form className="row" role="search" style={{ flex: '1 1 280px' }}>
          <input name="q" defaultValue={busca} placeholder="Buscar por nome ou telefone" aria-label="Buscar cliente" style={{ maxWidth: 360 }} />
          <button className="btn small" type="submit">Buscar</button>
        </form>
        <Link className="btn primary" href="/painel/clientes/novo">Novo cliente</Link>
      </div>
      {clientes?.length ? (
        <div className="list">
          {clientes.map((c) => (
            <Link key={c.id} className="item" href={`/painel/clientes/${c.id}`} style={{ textDecoration: 'none' }}>
              <span className="top"><b>{c.nome_completo}</b><span className="mono small">{telefoneBR(c.telefone)}</span></span>
              <span className="small muted">
                {(c.veiculos as unknown as { id: string }[] | null)?.length ?? 0} moto(s) · cadastro por {CANAL[c.canal_cadastro] ?? c.canal_cadastro}
                {c.perfil_id ? ' · tem login' : ' · sem login'} · {dataHora(c.criado_em)}
              </span>
            </Link>
          ))}
        </div>
      ) : <p className="panel muted">{busca ? 'Nenhum cliente encontrado. Confira a grafia ou cadastre um novo.' : 'Nenhum cliente cadastrado ainda.'}</p>}
    </div>
  );
}
