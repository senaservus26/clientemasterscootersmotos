'use server';
import { revalidatePath } from 'next/cache';
import { supabaseServidor } from '@/lib/supabase/server';
import { mensagemDoBanco } from '@/lib/erros';
import { anexoSchema, type Resultado } from '@/lib/validacao';

// O arquivo vai do navegador direto para o bucket privado; aqui só se registra no banco,
// que confere se o arquivo chegou e se a pessoa pode anexar nessa solicitação.
export async function registrarAnexo(entrada: { solicitacaoId: string; caminho: string; tipo: string; tamanho: number }): Promise<Resultado> {
  const dados = anexoSchema.safeParse(entrada);
  if (!dados.success) return { ok: false, erro: 'Arquivo inválido.' };
  const d = dados.data;
  const supabase = await supabaseServidor();
  const { error } = await supabase.rpc('registrar_anexo', { p_solicitacao: d.solicitacaoId, p_caminho: d.caminho, p_tipo: d.tipo, p_tamanho: d.tamanho });
  if (error) return { ok: false, erro: mensagemDoBanco(error) };
  revalidatePath(`/cliente/solicitacoes/${d.solicitacaoId}`);
  revalidatePath(`/painel/solicitacoes/${d.solicitacaoId}`);
  return { ok: true };
}
