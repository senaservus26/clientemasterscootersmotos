export const STATUS: Record<string, string> = {
  recebida: 'Solicitação recebida',
  aguardando_avaliacao: 'Aguardando avaliação',
  aguardando_info_cliente: 'Aguardando informações do cliente',
  aguardando_aprovacao_especialista: 'Aguardando aprovação do especialista',
  aguardando_agendamento: 'Aguardando agendamento',
  agendado: 'Agendado',
  veiculo_recebido: 'Veículo recebido',
  em_manutencao: 'Em manutenção',
  aguardando_aprovacao_orcamento: 'Aguardando aprovação de orçamento',
  concluido: 'Concluído',
  cancelado: 'Cancelado',
};

export function classeStatus(s: string): string {
  if (s === 'concluido' || s === 'agendado' || s === 'veiculo_recebido' || s === 'em_manutencao') return 't-ok';
  if (s === 'cancelado') return 't-crit';
  if (s === 'recebida') return 't-new';
  return 't-wait';
}

const TZ = 'America/Sao_Paulo';
export const dataHora = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
export const hora = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
export const diaCurto = (ymd: string) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', weekday: 'short', day: '2-digit', month: '2-digit' }).format(new Date(ymd + 'T12:00:00Z'));
export function hojeSP(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
}
export function somarDias(ymd: string, n: number): string {
  const d = new Date(ymd + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
