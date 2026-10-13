// Erros de regra de negócio vêm do banco com código P0001 e mensagem já em português.
// Qualquer outro erro vira uma mensagem genérica, sem detalhes internos.
export function mensagemDoBanco(erro: { code?: string; message?: string } | null | undefined): string {
  if (!erro) return 'Algo deu errado. Tente de novo.';
  if (erro.code === 'P0001' && erro.message) return erro.message;
  if (erro.code === '23505') return 'Este registro já existe.';
  if (erro.code === '23P01') return 'Esse horário acabou de ser ocupado. Escolha outro.';
  if (erro.code === '23514') return 'Algum dado está fora do formato esperado. Confira e tente de novo.';
  return 'Algo deu errado. Tente de novo em instantes.';
}
