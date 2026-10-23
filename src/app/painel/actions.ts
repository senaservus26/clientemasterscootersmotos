'use server';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { equipeAtual, exigirAdmin } from '@/lib/equipe';
import { mensagemDoBanco } from '@/lib/erros';
import {
  acessoSchema, bloqueioSchema, cancelamentoSchema, canalSchema, clienteEquipeSchema, confirmacaoSchema, membroEquipeSchema,
  preferenciasSchema, primeiroErro, solicitacaoSchema, triagemSchema, veiculoSchema, vinculoSchema, type Resultado,
} from '@/lib/validacao';
import { VERSAO_PRIVACIDADE } from '@/lib/textos';
import { argumentosVeiculo, dadosVeiculo } from '@/lib/veiculo';

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

// ------------------------------------------------------------ clientes cadastrados pela equipe (balcão, telefone, WhatsApp)
const idValido = (v: FormDataEntryValue | null) => confirmacaoSchema.shape.solicitacaoId.safeParse(String(v ?? '')).success;

export async function cadastrarClienteEquipe(_: Resultado | null, form: FormData): Promise<Resultado> {
  const { supabase } = await equipeAtual();
  const dados = clienteEquipeSchema.safeParse({
    nome: form.get('nome'), telefone: form.get('telefone'), email: form.get('email') ?? '', preferencia: form.get('preferencia'),
    canal: form.get('canal'), origem: form.get('origem'), cientePrivacidade: form.get('cientePrivacidade') === 'on',
    aceiteLembretes: form.get('aceiteLembretes') === 'on', aceiteMarketing: form.get('aceiteMarketing') === 'on',
  });
  if (!dados.success) return { ok: false, erro: primeiroErro(dados.error) };
  const d = dados.data;
  const { data, error } = await supabase.rpc('cadastrar_cliente_equipe', {
    p_nome: d.nome, p_telefone: d.telefone, p_email: d.email ?? null, p_preferencia: d.preferencia, p_canal: d.canal,
    p_origem_canal: d.origem, p_ciente_privacidade: d.cientePrivacidade, p_aceite_lembretes: d.aceiteLembretes,
    p_aceite_marketing: d.aceiteMarketing, p_versao_texto: VERSAO_PRIVACIDADE,
  });
  if (error || typeof data !== 'string') return { ok: false, erro: mensagemDoBanco(error) };
  revalidatePath('/painel/clientes');
  redirect(`/painel/clientes/${data}?ok=${encodeURIComponent('Cliente cadastrado. Agora cadastre a moto.')}`);
}

export async function salvarVeiculoEquipe(_: Resultado | null, form: FormData): Promise<Resultado> {
  const { supabase } = await equipeAtual();
  const clienteId = String(form.get('clienteId') ?? '');
  if (!idValido(clienteId)) return { ok: false, erro: 'Cliente não encontrado.' };
  const dados = veiculoSchema.safeParse(dadosVeiculo(form));
  if (!dados.success) return { ok: false, erro: primeiroErro(dados.error) };
  const { error } = await supabase.rpc('salvar_veiculo', argumentosVeiculo(clienteId, dados.data));
  if (error) return { ok: false, erro: mensagemDoBanco(error) };
  revalidatePath(`/painel/clientes/${clienteId}`);
  return { ok: true, mensagem: 'Moto cadastrada.' };
}

export async function abrirSolicitacaoEquipe(_: Resultado | null, form: FormData): Promise<Resultado> {
  const { supabase } = await equipeAtual();
  const clienteId = String(form.get('clienteId') ?? '');
  if (!idValido(clienteId)) return { ok: false, erro: 'Cliente não encontrado.' };
  const canal = canalSchema.safeParse(form.get('canal'));
  if (!canal.success) return { ok: false, erro: primeiroErro(canal.error) };
  const dados = solicitacaoSchema.safeParse({
    veiculoId: form.get('veiculoId'), servico: form.get('servico'), descricao: form.get('descricao'),
    sintomas: form.getAll('sintomas').map(String), inicioProblema: form.get('inicioProblema') ?? '',
    quilometragem: form.get('quilometragem'), disponibilidade: form.get('disponibilidade') ?? '',
  });
  if (!dados.success) return { ok: false, erro: primeiroErro(dados.error) };
  const d = dados.data;
  const { data, error } = await supabase.rpc('abrir_solicitacao_equipe', {
    p_cliente: clienteId, p_veiculo: d.veiculoId, p_servico_slug: d.servico, p_descricao: d.descricao, p_sintomas: d.sintomas,
    p_inicio_problema: d.inicioProblema ?? null, p_km: d.quilometragem, p_disponibilidade: d.disponibilidade ?? null, p_canal: canal.data,
  });
  if (error || !data?.[0]) return { ok: false, erro: mensagemDoBanco(error) };
  revalidatePath('/painel');
  redirect(`/painel/solicitacoes/${data[0].id}?ok=${encodeURIComponent(`Solicitação ${data[0].protocolo} registrada.`)}`);
}

export async function salvarPreferenciasEquipe(form: FormData): Promise<void> {
  const { supabase } = await equipeAtual();
  const clienteId = String(form.get('clienteId') ?? '');
  if (!idValido(clienteId)) redirect('/painel/clientes');
  const destino = `/painel/clientes/${clienteId}`;
  const canal = canalSchema.safeParse(form.get('canal'));
  if (!canal.success) voltar(destino, 'erro', primeiroErro(canal.error));
  const d = preferenciasSchema.parse({ lembretes: form.get('lembretes') === 'on', marketing: form.get('marketing') === 'on' });
  for (const [tipo, aceito] of [['lembretes', d.lembretes], ['marketing', d.marketing]] as const) {
    const { error } = await supabase.rpc('definir_consentimento', {
      p_tipo: tipo, p_aceito: aceito, p_versao_texto: VERSAO_PRIVACIDADE, p_cliente: clienteId, p_canal: canal.data,
    });
    if (error) voltar(destino, 'erro', mensagemDoBanco(error));
  }
  revalidatePath(destino);
  voltar(destino, 'ok', 'Preferências do cliente registradas.');
}

export async function vincularLoginCliente(form: FormData): Promise<void> {
  const { supabase } = await equipeAtual();
  const dados = vinculoSchema.safeParse({ clienteId: form.get('clienteId'), email: form.get('email') });
  const destino = `/painel/clientes/${String(form.get('clienteId') ?? '')}`;
  if (!dados.success) voltar(idValido(form.get('clienteId')) ? destino : '/painel/clientes', 'erro', primeiroErro(dados.error));
  const { error } = await supabase.rpc('vincular_login_cliente', { p_cliente: dados.data!.clienteId, p_email: dados.data!.email });
  revalidatePath(destino);
  if (error) voltar(destino, 'erro', mensagemDoBanco(error));
  voltar(destino, 'ok', 'Login ligado. O cliente já vê os pedidos dele na área do cliente.');
}
