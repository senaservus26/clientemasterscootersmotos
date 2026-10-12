import Link from 'next/link';
import { redirect } from 'next/navigation';
import { supabaseServidor } from '@/lib/supabase/server';
import { SolicitacaoForm } from '../formularios';

export const metadata = { title: 'Nova solicitação' };

export default async function NovaSolicitacao() {
  const supabase = await supabaseServidor();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/entrar');
  const [{ data: veiculos }, { data: servicos }, { data: sintomas }] = await Promise.all([
    supabase.from('veiculos').select('id, marca, modelo, ano, quilometragem').order('criado_em'),
    supabase.from('servicos').select('slug, nome').eq('ativo', true).order('ordem'),
    supabase.from('sintomas').select('slug, texto, risco').eq('ativo', true).order('risco', { ascending: false }),
  ]);
  if (!veiculos?.length) redirect('/cliente');
  return (
    <div className="wrap page" style={{ maxWidth: 820 }}>
      <p className="label"><Link href="/cliente">Área do cliente</Link></p>
      <h2 style={{ marginBottom: 16 }}>Nova solicitação</h2>
      <SolicitacaoForm
        veiculos={veiculos.map((v) => ({ id: v.id, rotulo: `${v.marca} ${v.modelo} · ${v.ano}`, km: v.quilometragem }))}
        servicos={servicos ?? []}
        sintomas={sintomas ?? []}
      />
    </div>
  );
}
