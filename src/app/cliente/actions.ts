'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { supabaseServidor } from '@/lib/supabase/server';
import { mensagemDoBanco } from '@/lib/erros';
import { cadastroSchema, veiculoSchema, solicitacaoSchema, preferenciaSchema, primeiroErro, type Resultado } from '@/lib/validacao';

const VERSAO_PRIVACIDADE = 'privacidade-2026-10-rascunho';

export async function registrarCliente(_: Resultado | null, form: FormData): Promise<Resultado> {
  const dados = cadastroSchema.safeParse({
    nome: form.get('nome'), telefone: form.get('telefone'), email: form.get('email') ?? '',
    preferencia: form.get('preferencia'), aceitePrivacidade: form.get('aceitePrivacidade') === 'on',
    aceiteLembretes: form.get('aceiteLembretes') === 'on', origem: form.get('origem'),
  });
  if (!dados.success) return { ok: false, erro: primeiroErro(dados.error) };
  const d = dados.data;
  const supabase = await supabaseServidor();
  const utm = Object.fromEntries(['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'landing_page']
    .map((k) => [k, String(form.get(k) ?? '').slice(0, 100) || null]));
  const { error } = await supabase.rpc('registrar_cliente', {
    p_nome: d.nome, p_telefone: d.telefone, p_email: d.email ?? null, p_preferencia: d.preferencia,
    p_aceite_privacidade: d.aceitePrivacidade, p_aceite_lembretes: d.aceiteLembretes,
    p_versao_texto: VERSAO_PRIVACIDADE, p_origem_canal: d.origem, p_utm: utm,
  });
  if (error) return { ok: false, erro: mensagemDoBanco(error) };
  revalidatePath('/cliente');
  return { ok: true, mensagem: 'Cadastro criado. Agora cadastre sua scooter.' };
}

export async function cadastrarVeiculo(_: Resultado | null, form: FormData): Promise<Resultado> {
  const dados = veiculoSchema.safeParse({
    marca: form.get('marca'), modelo: form.get('modelo'), ano: form.get('ano'), quilometragem: form.get('quilometragem'),
    placa: form.get('placa') || undefined, ultimaManutencao: form.get('ultimaManutencao') ?? '',
  });
  if (!dados.success) return { ok: false, erro: primeiroErro(dados.error) };
  const d = dados.data;
  const supabase = await supabaseServidor();
  const { error } = await supabase.rpc('cadastrar_veiculo', {
    p_marca: d.marca, p_modelo: d.modelo, p_ano: d.ano, p_km: d.quilometragem, p_placa: d.placa ?? null, p_ultima: d.ultimaManutencao ?? null,
  });
  if (error) return { ok: false, erro: mensagemDoBanco(error) };
  revalidatePath('/cliente');
  return { ok: true, mensagem: 'Scooter cadastrada.' };
}

export async function criarSolicitacao(_: Resultado | null, form: FormData): Promise<Resultado> {
  const dados = solicitacaoSchema.safeParse({
    veiculoId: form.get('veiculoId'), servico: form.get('servico'), descricao: form.get('descricao'),
    sintomas: form.getAll('sintomas').map(String), inicioProblema: form.get('inicioProblema') ?? '',
    quilometragem: form.get('quilometragem'), disponibilidade: form.get('disponibilidade') ?? '',
  });
  if (!dados.success) return { ok: false, erro: primeiroErro(dados.error) };
  const d = dados.data;
  const supabase = await supabaseServidor();
  const { data, error } = await supabase.rpc('criar_solicitacao', {
    p_veiculo: d.veiculoId, p_servico_slug: d.servico, p_descricao: d.descricao, p_sintomas: d.sintomas,
    p_inicio_problema: d.inicioProblema ?? null, p_km: d.quilometragem, p_disponibilidade: d.disponibilidade ?? null,
  });
  if (error || !data?.[0]) return { ok: false, erro: mensagemDoBanco(error) };
  revalidatePath('/cliente');
  redirect(`/cliente/solicitacoes/${data[0].id}?nova=1`);
}

export async function indicarPreferencia(form: FormData): Promise<void> {
  const dados = preferenciaSchema.safeParse({ solicitacaoId: form.get('solicitacaoId'), inicio: form.get('inicio') });
  if (!dados.success) redirect('/cliente');
  const { solicitacaoId, inicio } = dados.data;
  const supabase = await supabaseServidor();
  const { error } = await supabase.rpc('indicar_preferencia', { p_solicitacao: solicitacaoId, p_inicio: inicio });
  const destino = `/cliente/solicitacoes/${solicitacaoId}`;
  revalidatePath(destino);
  if (error) redirect(`${destino}?erro=${encodeURIComponent(mensagemDoBanco(error))}`);
  redirect(`${destino}?preferencia=1`);
}
