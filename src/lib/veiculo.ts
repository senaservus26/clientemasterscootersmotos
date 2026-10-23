import type { z } from 'zod';
import type { veiculoSchema } from '@/lib/validacao';

// Mesmo formulário de moto para o cliente (site) e para a equipe (balcão).
export function dadosVeiculo(form: FormData) {
  return {
    marca: form.get('marca'), modelo: form.get('modelo'), ano: form.get('ano'), anoModelo: form.get('anoModelo') ?? '',
    quilometragem: form.get('quilometragem'), placa: form.get('placa') || undefined,
    ultimaManutencao: form.get('ultimaManutencao') ?? '', historico: form.get('historico') ?? '', observacoes: form.get('observacoes') ?? '',
  };
}

export function argumentosVeiculo(clienteId: string | null, d: z.output<typeof veiculoSchema>) {
  return {
    p_cliente: clienteId, p_marca: d.marca, p_modelo: d.modelo, p_ano: d.ano, p_ano_modelo: d.anoModelo ?? null, p_km: d.quilometragem,
    p_placa: d.placa ?? null, p_ultima: d.ultimaManutencao ?? null, p_historico: d.historico ?? null, p_observacoes: d.observacoes ?? null,
  };
}
