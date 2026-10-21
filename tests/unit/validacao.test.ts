import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acessoSchema, cadastroSchema, membroEquipeSchema, solicitacaoSchema, tokenProtocoloSchema, veiculoSchema } from '../../src/lib/validacao.ts';
import { mensagemDoBanco } from '../../src/lib/erros.ts';

const cadastroBase = { nome: 'Ana Teste', telefone: '(13) 91234-5678', email: '', preferencia: 'whatsapp', aceitePrivacidade: true, aceiteLembretes: false, origem: 'instagram' };

test('cadastro normaliza telefone e aceita e-mail vazio', () => {
  const r = cadastroSchema.parse(cadastroBase);
  assert.equal(r.telefone, '13912345678');
  assert.equal(r.email, undefined);
});

test('cadastro recusa sem aceite, telefone curto e nome sem sobrenome', () => {
  assert.equal(cadastroSchema.safeParse({ ...cadastroBase, aceitePrivacidade: false }).success, false);
  assert.match(cadastroSchema.safeParse({ ...cadastroBase, telefone: '1234' }).error!.issues[0].message, /DDD/);
  assert.match(cadastroSchema.safeParse({ ...cadastroBase, nome: 'Ana' }).error!.issues[0].message, /sobrenome/);
});

test('veículo valida ano, quilometragem e placa', () => {
  const ok = veiculoSchema.parse({ marca: 'Honda', modelo: 'PCX 160', ano: '2022', quilometragem: '18.400', placa: 'abc-1d23', ultimaManutencao: '' });
  assert.deepEqual([ok.ano, ok.quilometragem, ok.placa], [2022, 18400, 'ABC1D23']);
  assert.equal(veiculoSchema.safeParse({ marca: 'Honda', modelo: 'PCX', ano: '2099', quilometragem: '1' }).success, false);
  assert.equal(veiculoSchema.safeParse({ marca: 'Honda', modelo: 'PCX', ano: '2020', quilometragem: '' }).success, false);
  assert.equal(veiculoSchema.safeParse({ marca: 'Honda', modelo: 'PCX', ano: '2020', quilometragem: '10', placa: 'XYZ' }).success, false);
});

test('solicitação exige descrição mínima e sintomas válidos', () => {
  const base = { veiculoId: '7b0c1f1e-5d7a-4f33-9b8e-2a1b3c4d5e6f', servico: 'freios', descricao: 'Freio chiando ao parar.', sintomas: ['freio-fraco'], quilometragem: '18500' };
  assert.equal(solicitacaoSchema.parse(base).quilometragem, 18500);
  assert.equal(solicitacaoSchema.safeParse({ ...base, descricao: 'ruim' }).success, false);
  assert.equal(solicitacaoSchema.safeParse({ ...base, sintomas: ['<script>'] }).success, false);
});

test('erros do banco viram mensagens sem detalhes internos', () => {
  assert.equal(mensagemDoBanco({ code: 'P0001', message: 'Somente a equipe da oficina confirma agendamentos.' }), 'Somente a equipe da oficina confirma agendamentos.');
  assert.match(mensagemDoBanco({ code: '23P01', message: 'conflicting key value violates exclusion constraint' }), /ocupado/);
  assert.doesNotMatch(mensagemDoBanco({ code: '42501', message: 'permission denied for table solicitacoes' }), /permission|table/);
});

test('triagem converte campos vazios em nulo e limita o tempo estimado', async () => {
  const { triagemSchema } = await import('../../src/lib/validacao.ts');
  const base = { solicitacaoId: '7b0c1f1e-5d7a-4f33-9b8e-2a1b3c4d5e6f', status: 'aguardando_agendamento', prioridade: '', servico: '', tempoEstimado: '', nota: '' };
  const r = triagemSchema.parse(base);
  assert.deepEqual([r.prioridade, r.servico, r.tempoEstimado, r.nota], [null, null, null, undefined]);
  assert.equal(triagemSchema.parse({ ...base, prioridade: 'alta', tempoEstimado: '90' }).tempoEstimado, 90);
  assert.equal(triagemSchema.safeParse({ ...base, tempoEstimado: '5' }).success, false);
  assert.equal(triagemSchema.safeParse({ ...base, status: 'inventado' }).success, false);
});

test('bloqueio monta o período no fuso da oficina e exige fim depois do início', async () => {
  const { bloqueioSchema } = await import('../../src/lib/validacao.ts');
  const ok = bloqueioSchema.parse({ data: '2026-10-13', inicio: '08:00', fim: '12:30', recursoId: '', motivo: 'Feriado' });
  assert.equal(ok.periodo, '[2026-10-13T08:00:00-03:00,2026-10-13T12:30:00-03:00)');
  assert.equal(ok.recursoId, null);
  assert.match(bloqueioSchema.safeParse({ data: '2026-10-13', inicio: '12:00', fim: '08:00', recursoId: '', motivo: 'Feriado' }).error!.issues[0].message, /fim/);
});

test('equipe: e-mail normalizado, perfil só entre os permitidos', () => {
  const r = membroEquipeSchema.parse({ email: ' Carla@Oficina.com ', nome: 'Carla', papel: 'atendente' });
  assert.equal(r.email, 'carla@oficina.com');
  assert.equal(membroEquipeSchema.safeParse({ email: 'carla@oficina.com', nome: 'Carla', papel: 'dono' }).success, false);
  assert.equal(membroEquipeSchema.safeParse({ email: 'carla', nome: 'Carla', papel: 'admin' }).success, false);
  assert.equal(acessoSchema.parse({ perfilId: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b', ativo: 'nao' }).ativo, false);
});

test('link de acompanhamento aceita só token de 64 caracteres hexadecimais', () => {
  assert.equal(tokenProtocoloSchema.safeParse('a'.repeat(64)).success, true);
  assert.equal(tokenProtocoloSchema.safeParse('A'.repeat(64)).success, false);
  assert.equal(tokenProtocoloSchema.safeParse('../../etc').success, false);
});
