import { z } from 'zod';

// Mesmas regras do banco, verificadas antes para dar mensagens claras ao cliente.
const somenteDigitos = (v: string) => v.replace(/\D/g, '');
const anoMaximo = () => new Date().getFullYear() + 1;
const textoOpcional = (max: number) =>
  z.string().trim().max(max).optional().transform((v) => (v ? v : undefined));

export const cadastroSchema = z.object({
  nome: z.string().trim().min(3, 'Informe nome e sobrenome.').max(120)
    .refine((v) => v.split(/\s+/).length >= 2, 'Informe nome e sobrenome.'),
  telefone: z.string().transform(somenteDigitos)
    .refine((v) => v.length === 10 || v.length === 11, 'Informe o telefone com DDD, por exemplo (13) 91234-5678.'),
  email: z.union([z.literal(''), z.string().trim().email('O e-mail parece incompleto.')]).optional()
    .transform((v) => (v ? v : undefined)),
  preferencia: z.enum(['whatsapp', 'email', 'telefone']),
  aceitePrivacidade: z.literal(true, { errorMap: () => ({ message: 'É preciso concordar com o aviso de privacidade.' }) }),
  aceiteLembretes: z.boolean(),
  aceiteMarketing: z.boolean().default(false),
  origem: z.enum(['instagram', 'anuncio', 'google', 'indicacao', 'whatsapp', 'site', 'outro']),
});

export const veiculoSchema = z.object({
  marca: z.string().trim().min(2, 'Informe a marca.').max(40),
  modelo: z.string().trim().min(1, 'Informe o modelo.').max(60),
  ano: z.coerce.number().int().min(1980, 'Ano inválido.').refine((a) => a <= anoMaximo(), 'Ano inválido.'),
  quilometragem: z.string().transform(somenteDigitos).pipe(
    z.string().min(1, 'Informe a quilometragem atual.').transform(Number).pipe(z.number().max(500000, 'Quilometragem acima do limite.')),
  ),
  placa: z.string().trim().toUpperCase().transform((v) => v.replace(/[^A-Z0-9]/g, '')).optional()
    .refine((v) => !v || /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(v), 'Placa inválida. Use o formato ABC1D23 ou ABC1234.')
    .transform((v) => (v ? v : undefined)),
  ultimaManutencao: z.union([z.literal(''), z.string().date()]).optional().transform((v) => (v ? v : undefined)),
  anoModelo: z.union([z.literal(''), z.coerce.number().int()]).optional().transform((v) => (v === '' || v === undefined ? undefined : v)),
  historico: textoOpcional(2000),
  observacoes: textoOpcional(1000),
}).refine((v) => v.anoModelo === undefined || v.anoModelo === v.ano || v.anoModelo === v.ano + 1,
  { message: 'O ano do modelo é o mesmo da fabricação ou o seguinte.', path: ['anoModelo'] });

export const solicitacaoSchema = z.object({
  veiculoId: z.string().uuid('Escolha a scooter.'),
  servico: z.string().regex(/^[a-z0-9-]+$/),
  descricao: z.string().trim().min(10, 'Descreva o problema com pelo menos algumas palavras.').max(2000),
  sintomas: z.array(z.string().regex(/^[a-z0-9-]+$/)).max(20),
  inicioProblema: textoOpcional(100),
  quilometragem: z.string().transform(somenteDigitos).pipe(
    z.string().min(1, 'Informe a quilometragem atual.').transform(Number).pipe(z.number().max(500000)),
  ),
  disponibilidade: textoOpcional(200),
});

export const preferenciaSchema = z.object({
  solicitacaoId: z.string().uuid(),
  inicio: z.string().datetime({ offset: true }),
});

export type Resultado = { ok: true; mensagem?: string } | { ok: false; erro: string };

export function primeiroErro(e: z.ZodError): string {
  return e.issues[0]?.message ?? 'Confira os dados informados.';
}

// ---------------------------------------------------------------- painel da oficina
const STATUS_TRIAGEM = [
  'recebida', 'aguardando_avaliacao', 'aguardando_info_cliente', 'aguardando_aprovacao_especialista',
  'aguardando_agendamento', 'agendado', 'veiculo_recebido', 'em_manutencao', 'aguardando_aprovacao_orcamento',
  'concluido', 'cancelado',
] as const;
const hhmm = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, 'Horário inválido.');

export const triagemSchema = z.object({
  solicitacaoId: z.string().uuid(),
  status: z.enum(STATUS_TRIAGEM),
  prioridade: z.union([z.literal(''), z.enum(['baixa', 'media', 'alta', 'urgente'])]).transform((v) => v || null),
  servico: z.union([z.literal(''), z.string().regex(/^[a-z0-9-]+$/)]).transform((v) => v || null),
  tempoEstimado: z.union([z.literal(''), z.coerce.number().int().min(15, 'Tempo estimado mínimo: 15 minutos.').max(4800, 'Tempo estimado acima do limite.')])
    .transform((v) => (v === '' ? null : v)),
  nota: textoOpcional(2000),
});

export const confirmacaoSchema = z.object({
  solicitacaoId: z.string().uuid(),
  inicio: z.string().datetime({ offset: true }),
});

export const cancelamentoSchema = z.object({
  agendamentoId: z.string().uuid(),
  solicitacaoId: z.string().uuid(),
  motivo: z.string().trim().min(3, 'Informe o motivo do cancelamento.').max(200),
});

// O Brasil não tem horário de verão desde 2019; o fuso de Praia Grande é sempre -03:00.
export const bloqueioSchema = z.object({
  data: z.string().date('Data inválida.'),
  inicio: hhmm,
  fim: hhmm,
  recursoId: z.union([z.literal(''), z.string().uuid()]).transform((v) => v || null),
  motivo: z.string().trim().min(2, 'Informe o motivo do bloqueio.').max(200),
}).refine((b) => b.fim > b.inicio, { message: 'O fim precisa ser depois do início.', path: ['fim'] })
  .transform((b) => ({
    recursoId: b.recursoId, motivo: b.motivo, data: b.data,
    periodo: `[${b.data}T${b.inicio}:00-03:00,${b.data}T${b.fim}:00-03:00)`,
  }));

export const membroEquipeSchema = z.object({
  email: z.string().trim().toLowerCase().email('Informe o e-mail que a pessoa usou para entrar.'),
  nome: z.string().trim().min(2, 'Informe o nome da pessoa.').max(120),
  papel: z.enum(['admin', 'atendente', 'especialista', 'cliente']),
});

export const acessoSchema = z.object({
  perfilId: z.string().uuid(),
  ativo: z.enum(['sim', 'nao']).transform((v) => v === 'sim'),
});

// o link de acompanhamento leva só o token; o resto é validado no banco
export const tokenProtocoloSchema = z.string().regex(/^[0-9a-f]{64}$/);

// ---------------------------------------------------------------- Etapa 5: cadastro pela equipe e anexos
export const CANAIS_EQUIPE = { balcao: 'Balcão', telefone: 'Telefone', whatsapp: 'WhatsApp' } as const;
const canalEquipe = z.enum(['balcao', 'telefone', 'whatsapp'], { errorMap: () => ({ message: 'Informe por onde o cliente chegou.' }) });

export const clienteEquipeSchema = z.object({
  nome: z.string().trim().min(3, 'Informe nome e sobrenome.').max(120),
  telefone: z.string().transform(somenteDigitos)
    .refine((v) => v.length === 10 || v.length === 11, 'Informe o telefone com DDD, por exemplo (13) 91234-5678.'),
  email: z.union([z.literal(''), z.string().trim().email('O e-mail parece incompleto.')]).optional()
    .transform((v) => (v ? v : undefined)),
  preferencia: z.enum(['whatsapp', 'email', 'telefone']),
  canal: canalEquipe,
  origem: z.enum(['instagram', 'anuncio', 'google', 'indicacao', 'whatsapp', 'site', 'outro']),
  cientePrivacidade: z.literal(true, { errorMap: () => ({ message: 'Confirme que o cliente foi informado sobre o aviso de privacidade.' }) }),
  aceiteLembretes: z.boolean(),
  aceiteMarketing: z.boolean(),
});

export const preferenciasSchema = z.object({
  lembretes: z.boolean(),
  marketing: z.boolean(),
});

export const canalSchema = canalEquipe;

export const vinculoSchema = z.object({
  clienteId: z.string().uuid(),
  email: z.string().trim().toLowerCase().email('Informe o e-mail que o cliente usou para entrar no site.'),
});

export const LIMITE_ANEXO_BYTES = 50 * 1024 * 1024;
export const EXTENSOES_ANEXO: Record<string, 'foto' | 'video'> = {
  jpg: 'foto', jpeg: 'foto', png: 'foto', webp: 'foto', heic: 'foto', mp4: 'video', mov: 'video',
};

export const anexoSchema = z.object({
  solicitacaoId: z.string().uuid(),
  caminho: z.string().regex(/^[0-9a-f-]{36}\/[a-z0-9-]+\.(jpg|jpeg|png|webp|heic|mp4|mov)$/),
  tipo: z.enum(['foto', 'video']),
  tamanho: z.coerce.number().int().min(1).max(LIMITE_ANEXO_BYTES, 'Arquivo acima de 50 MB.'),
}).refine((a) => a.caminho.startsWith(a.solicitacaoId + '/'), { message: 'Arquivo inválido.' });
