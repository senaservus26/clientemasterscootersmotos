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
});

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
