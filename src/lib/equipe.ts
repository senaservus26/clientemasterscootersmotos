import { redirect } from 'next/navigation';
import { supabaseServidor } from '@/lib/supabase/server';

export type Papel = 'admin' | 'atendente' | 'especialista';

export const PAPEIS: Record<Papel, string> = { admin: 'Administrador', atendente: 'Atendente', especialista: 'Especialista' };

// Abre uma página do painel só para quem tem papel de equipe ativo.
// O banco repete essa checagem em cada leitura (RLS) e em cada função.
export async function equipeAtual() {
  const supabase = await supabaseServidor();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/entrar');
  const { data: perfil } = await supabase.from('perfis').select('papel, nome, ativo').eq('id', user.id).maybeSingle();
  if (perfil && !perfil.ativo) redirect('/sem-acesso');
  if (!perfil || perfil.papel === 'cliente') redirect('/cliente');
  const papel = perfil.papel as Papel;
  return { supabase, user, papel, nome: perfil.nome as string, admin: papel === 'admin', definePrioridade: papel === 'admin' || papel === 'especialista' };
}

// Telas e ações de gestão da equipe: só administrador. O banco recusa os demais de novo.
export async function exigirAdmin() {
  const equipe = await equipeAtual();
  if (!equipe.admin) redirect('/painel?erro=' + encodeURIComponent('Somente o administrador gerencia a equipe.'));
  return equipe;
}
