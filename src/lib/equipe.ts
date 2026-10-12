import { redirect } from 'next/navigation';
import { supabaseServidor } from '@/lib/supabase/server';

export type Papel = 'admin' | 'atendente' | 'especialista';

// Abre uma página do painel só para quem tem papel de equipe ativo.
// O banco repete essa checagem em cada leitura (RLS) e em cada função.
export async function equipeAtual() {
  const supabase = await supabaseServidor();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/entrar');
  const { data: perfil } = await supabase.from('perfis').select('papel, nome, ativo').eq('id', user.id).maybeSingle();
  if (!perfil?.ativo || perfil.papel === 'cliente') redirect('/cliente');
  const papel = perfil.papel as Papel;
  return { supabase, user, papel, nome: perfil.nome as string, definePrioridade: papel === 'admin' || papel === 'especialista' };
}
