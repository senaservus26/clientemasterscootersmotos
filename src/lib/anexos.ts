import type { SupabaseClient } from '@supabase/supabase-js';

export type Anexo = { id: string; tipo: 'foto' | 'video'; url: string | null; criado_em: string };

// Links temporários (10 minutos) para mostrar os arquivos do bucket privado; o RLS decide quem pode gerar.
export async function listarAnexos(supabase: SupabaseClient, solicitacaoId: string): Promise<Anexo[]> {
  const { data } = await supabase.from('anexos').select('id, tipo, caminho, criado_em').eq('solicitacao_id', solicitacaoId).order('criado_em');
  if (!data?.length) return [];
  const { data: links } = await supabase.storage.from('anexos').createSignedUrls(data.map((a) => a.caminho), 600);
  const porCaminho = new Map((links ?? []).map((l) => [l.path, l.signedUrl]));
  return data.map((a) => ({ id: a.id, tipo: a.tipo, url: porCaminho.get(a.caminho) ?? null, criado_em: a.criado_em }));
}
