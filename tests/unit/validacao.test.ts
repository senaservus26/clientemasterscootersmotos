import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cadastroSchema, veiculoSchema, solicitacaoSchema } from '../../src/lib/validacao.ts';
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
