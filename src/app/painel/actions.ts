'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { equipeAtual } from '@/lib/equipe';
import { mensagemDoBanco } from '@/lib/erros';
import { bloqueioSchema, cancelamentoSchema, confirmacaoSchema, primeiroErro, triagemSchema } from '@/lib/validacao';

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
