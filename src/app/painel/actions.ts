'use server';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { equipeAtual, exigirAdmin } from '@/lib/equipe';
import { mensagemDoBanco } from '@/lib/erros';
import { acessoSchema, bloqueioSchema, cancelamentoSchema, confirmacaoSchema, membroEquipeSchema, primeiroErro, triagemSchema } from '@/lib/validacao';

const voltar = (destino: string, chave: 'ok' | 'erro', texto: string): never =>
  redirect(`${destino}${destino.includes('?') ? '&' : '?'}${chave}=${encodeURIComponent(texto)}`);

export async function salvarTriagem(form: FormData): Promise<void> {
  const { supabase, definePrioridade } = await equipeAtual();
  const id = String(form.get('solicitacaoId') ?? '');
  const destino = `/painel/solicitacoes/${id}`;
  const dados = triagemSchema.safeParse({
    solicitacaoId: id, status: form.get('status'), prioridade: form.get('prioridade') ?? '',
    servico: form.get('servico') ?? '', tempoEstimado: form.get('tempoEstimado') ?? '', nota: form.get('nota') ?? '',
  });
  if (!dados.success) voltar(destino, 'erro', primeiroErro(dados.error));
  const d = dados.data!;
  // quem não pode definir prioridade reenvia a atual; o banco recusa qualquer mudança dessa pessoa
  const prioridade = definePrioridade ? d.prioridade : (String(form.get('prioridadeAtual') ?? '') || null);
  const { error } = await supabase.rpc('atualizar_triagem', {
    p_solicitacao: d.solicitacaoId, p_status: d.status, p_prioridade: prioridade,
    p_servico_slug: d.servico, p_tempo_estimado_min: d.tempoEstimado, p_nota_interna: d.nota ?? null,
  });
  revalidatePath('/painel');
  if (error) voltar(destino, 'erro', mensagemDoBanco(error));
  voltar(destino, 'ok', 'Triagem salva.');
}

export async function confirmarAgendamento(form: FormData): Promise<void> {
  const { supabase } = await equipeAtual();
  const dados = confirmacaoSchema.safeParse({ solicitacaoId: form.get('solicitacaoId'), inicio: form.get('inicio') });
  if (!dados.success) redirect('/painel');
  const { solicitacaoId, inicio } = dados.data;
  const destino = `/painel/solicitacoes/${solicitacaoId}`;
  const { error } = await supabase.rpc('confirmar_agendamento', { p_solicitacao: solicitacaoId, p_inicio: inicio });
  revalidatePath('/painel');
  if (error) voltar(destino, 'erro', mensagemDoBanco(error));
  voltar(destino, 'ok', 'Agendamento confirmado.');
}

export async function cancelarAgendamento(form: FormData): Promise<void> {
  const { supabase } = await equipeAtual();
  const dados = cancelamentoSchema.safeParse({
    agendamentoId: form.get('agendamentoId'), solicitacaoId: form.get('solicitacaoId'), motivo: form.get('motivo'),
  });
  const destino = `/painel/solicitacoes/${String(form.get('solicitacaoId') ?? '')}`;
  if (!dados.success) voltar(destino, 'erro', primeiroErro(dados.error));
  const { error } = await supabase.rpc('cancelar_agendamento', { p_agendamento: dados.data!.agendamentoId, p_motivo: dados.data!.motivo });
  revalidatePath('/painel');
  if (error) voltar(destino, 'erro', mensagemDoBanco(error));
  voltar(destino, 'ok', 'Agendamento cancelado. A solicitação voltou para aguardando agendamento.');
}

export async function criarBloqueio(form: FormData): Promise<void> {
  const { supabase, user } = await equipeAtual();
  const dados = bloqueioSchema.safeParse({
    data: form.get('data'), inicio: form.get('inicio'), fim: form.get('fim'),
    recursoId: form.get('recursoId') ?? '', motivo: form.get('motivo'),
  });
  const dia = String(form.get('data') ?? '');
  const destino = `/painel/agenda?dia=${encodeURIComponent(dia)}`;
  if (!dados.success) voltar(destino, 'erro', primeiroErro(dados.error));
  const b = dados.data!;
  const { error } = await supabase.from('bloqueios')
    .insert({ recurso_id: b.recursoId, periodo: b.periodo, motivo: b.motivo, criado_por: user.id });
  revalidatePath('/painel/agenda');
  if (error) voltar(destino, 'erro', mensagemDoBanco(error));
  voltar(destino, 'ok', 'Bloqueio criado. Esses horários saem da agenda do cliente.');
}

export async function removerBloqueio(form: FormData): Promise<void> {
  const { supabase } = await equipeAtual();
  const id = String(form.get('bloqueioId') ?? '');
  const destino = `/painel/agenda?dia=${encodeURIComponent(String(form.get('dia') ?? ''))}`;
  const { error } = await supabase.from('bloqueios').delete().eq('id', id);
  revalidatePath('/painel/agenda');
  if (error) voltar(destino, 'erro', mensagemDoBanco(error));
  voltar(destino, 'ok', 'Bloqueio removido.');
}

// ------------------------------------------------------------ equipe (somente administrador)
export async function salvarMembroEquipe(form: FormData): Promise<void> {
  const { supabase } = await exigirAdmin();
  const destino = '/painel/equipe';
  const dados = membroEquipeSchema.safeParse({ email: form.get('email'), nome: form.get('nome'), papel: form.get('papel') });
  if (!dados.success) voltar(destino, 'erro', primeiroErro(dados.error));
  const d = dados.data!;
  const { error } = await supabase.rpc('definir_perfil_equipe', { p_email: d.email, p_papel: d.papel, p_nome: d.nome });
  revalidatePath(destino);
  if (error) voltar(destino, 'erro', mensagemDoBanco(error));
  voltar(destino, 'ok', d.papel === 'cliente' ? `${d.nome} saiu da equipe.` : `Perfil de ${d.nome} salvo.`);
}

export async function alterarAcesso(form: FormData): Promise<void> {
  const { supabase } = await exigirAdmin();
  const destino = '/painel/equipe';
  const dados = acessoSchema.safeParse({ perfilId: form.get('perfilId'), ativo: form.get('ativo') });
  if (!dados.success) voltar(destino, 'erro', 'Pedido inválido.');
  const { error } = await supabase.rpc('definir_acesso', { p_perfil: dados.data!.perfilId, p_ativo: dados.data!.ativo });
  revalidatePath(destino);
  if (error) voltar(destino, 'erro', mensagemDoBanco(error));
  voltar(destino, 'ok', dados.data!.ativo ? 'Acesso reativado.' : 'Acesso desativado. A pessoa perde o acesso na próxima página que abrir.');
}

// ------------------------------------------------------------ link de acompanhamento sem login
// O link aparece uma única vez para a equipe copiar: vai num cookie curto, nunca na URL nem no banco.
export async function gerarLinkAcompanhamento(form: FormData): Promise<void> {
  const { supabase } = await equipeAtual();
  const id = String(form.get('solicitacaoId') ?? '');
  if (!confirmacaoSchema.shape.solicitacaoId.safeParse(id).success) redirect('/painel');
  const destino = `/painel/solicitacoes/${id}`;
  const { data, error } = await supabase.rpc('gerar_acesso_protocolo', { p_solicitacao: id });
  if (error || typeof data !== 'string') voltar(destino, 'erro', error ? mensagemDoBanco(error) : 'Não foi possível gerar o link.');
  (await cookies()).set(`ms_link_${id}`, data as string, { httpOnly: true, secure: true, sameSite: 'strict', maxAge: 300, path: destino });
  voltar(destino, 'ok', 'Link gerado. Copie e envie ao cliente; ele vale por 30 dias e o anterior deixou de funcionar.');
}

export async function revogarLinkAcompanhamento(form: FormData): Promise<void> {
  const { supabase } = await equipeAtual();
  const id = String(form.get('solicitacaoId') ?? '');
  if (!confirmacaoSchema.shape.solicitacaoId.safeParse(id).success) redirect('/painel');
  const destino = `/painel/solicitacoes/${id}`;
  const { error } = await supabase.rpc('revogar_acesso_protocolo', { p_solicitacao: id });
  (await cookies()).delete({ name: `ms_link_${id}`, path: destino });
  if (error) voltar(destino, 'erro', mensagemDoBanco(error));
  voltar(destino, 'ok', 'Link de acompanhamento desativado.');
}
