// Testes da Etapa 5: cadastro pelo balcão, moto completa, consentimentos, solicitação pela equipe e anexos.
// Usa um banco próprio. Mesmas variáveis TEST_PG_*.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const conn = {
  host: process.env.TEST_PG_HOST ?? '/tmp/pg',
  port: Number(process.env.TEST_PG_PORT ?? 54329),
  user: process.env.TEST_PG_USER ?? 'postgres',
  password: process.env.TEST_PG_PASSWORD,
};
const DB = 'masterscooter_cadastro';
const root = new URL('../../', import.meta.url);
const ler = (p) => readFileSync(new URL(p, root), 'utf8');

let pool;
const U = { admin: randomUUID(), atendente: randomUUID(), especialista: randomUUID(), ana: randomUUID(), novo: randomUUID(), carla: randomUUID() };
const D = {};

async function como(uid, sql, params = []) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    if (uid) await c.query("select set_config('request.jwt.claim.sub', $1, true)", [uid]);
    await c.query(uid ? 'set local role authenticated' : 'set local role anon');
    const r = await c.query(sql, params);
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}
const falha = (promessa, trecho) => assert.rejects(promessa, (e) => {
  assert.match(e.message, trecho);
  return true;
});
const um = async (sql, params = []) => (await pool.query(sql, params)).rows[0];

before(async () => {
  const adm = new pg.Client({ ...conn, database: 'postgres' });
  await adm.connect();
  await adm.query(`drop database if exists ${DB} with (force)`);
  await adm.query(`create database ${DB}`);
  await adm.end();
  pool = new pg.Pool({ ...conn, database: DB, max: 4 });
  await pool.query(ler('tests/db/supabase-shim.sql'));
  for (const f of readdirSync(new URL('supabase/migrations/', root)).sort()) {
    await pool.query(ler(`supabase/migrations/${f}`));
  }
  await pool.query(ler('supabase/seed.sql'));
  for (const [nome, id] of Object.entries(U)) {
    await pool.query('insert into auth.users (id, email) values ($1, $2)', [id, `${nome}@exemplo.test`]);
  }
  for (const papel of ['admin', 'atendente', 'especialista']) {
    await pool.query('insert into public.perfis (id, papel, nome) values ($1, $2, $3)', [U[papel], papel, `Equipe ${papel}`]);
  }
  await como(U.ana, `select public.registrar_cliente('Ana Souza', '13911110000', null, 'whatsapp', true, true, 'v1')`);
  D.ana = (await um('select id from public.clientes where perfil_id = $1', [U.ana])).id;
  D.veiculoAna = (await como(U.ana, `select public.salvar_veiculo(null, 'Honda', 'PCX', 2022, 2023, 15000) id`)).rows[0].id;
});
after(async () => { await pool?.end(); });

const balcao = (quem, tel, extra = {}) => como(quem,
  `select public.cadastrar_cliente_equipe($1, $2, $3, 'whatsapp', $4, 'indicacao', $5, $6, $7, 'v1') id`,
  [extra.nome ?? 'Carla Balcão', tel, extra.email ?? null, extra.canal ?? 'balcao', extra.ciente ?? true, extra.lembretes ?? false, extra.marketing ?? false]);

test('atendente cadastra cliente no balcão sem login nem e-mail, com consentimentos separados', async () => {
  await falha(balcao(U.ana, '13933330000'), /restrito à equipe/);
  await falha(balcao(U.atendente, '13933330000', { ciente: false }), /aviso de privacidade/);
  await falha(balcao(U.atendente, '13933330000', { canal: 'site' }), /por onde o cliente chegou/);
  await falha(balcao(U.atendente, '139'), /telefone com DDD/);
  await falha(balcao(U.atendente, '(13) 91111-0000'), /já tem cadastro/);
  const id = (await balcao(U.atendente, '(13) 93333-0000', { lembretes: true, email: 'Carla@Exemplo.test' })).rows[0].id;
  const c = await um('select perfil_id, telefone, email, cadastrado_por, canal_cadastro from public.clientes where id = $1', [id]);
  assert.deepEqual(c, { perfil_id: null, telefone: '13933330000', email: 'carla@exemplo.test', cadastrado_por: U.atendente, canal_cadastro: 'balcao' });
  const cons = await como(U.atendente, 'select tipo, aceito, canal from public.consentimentos_atuais where cliente_id = $1 order by tipo', [id]);
  assert.deepEqual(cons.rows, [
    { tipo: 'lembretes', aceito: true, canal: 'balcao' },
    { tipo: 'marketing', aceito: false, canal: 'balcao' },
    { tipo: 'privacidade', aceito: true, canal: 'balcao' },
  ]);
  D.carla = id;
});

test('moto com ano-modelo, histórico e observações; cliente só cadastra para si, a equipe para qualquer um', async () => {
  await falha(como(U.ana, `select public.salvar_veiculo($1, 'Yamaha', 'NMax', 2021, 2022, 9000)`, [D.carla]), /restrito à equipe/);
  await falha(como(U.atendente, `select public.salvar_veiculo($1, 'Yamaha', 'NMax', 2021, 2023, 9000)`, [D.carla]), /ano do modelo/);
  await falha(como(U.atendente, `select public.salvar_veiculo($1, 'Yamaha', 'NMax', 2021, 2022, 9000, null, '2999-01-01')`, [D.carla]), /futuro/);
  const v = (await como(U.atendente,
    `select public.salvar_veiculo($1, 'Yamaha', 'NMax', 2021, 2022, 9000, 'abc-1d23', '2026-05-10', 'Troca de óleo em maio', 'Arranhão no paralama') id`, [D.carla])).rows[0].id;
  const r = await um('select cliente_id, placa, ano_modelo, historico_informado, observacoes from public.veiculos where id = $1', [v]);
  assert.deepEqual(r, { cliente_id: D.carla, placa: 'ABC1D23', ano_modelo: 2022, historico_informado: 'Troca de óleo em maio', observacoes: 'Arranhão no paralama' });
  D.veiculoCarla = v;
});

test('cliente muda as próprias preferências; o histórico fica guardado', async () => {
  await como(U.ana, `select public.definir_consentimento('marketing', true, 'v2')`);
  await como(U.ana, `select public.definir_consentimento('lembretes', false, 'v2')`);
  await falha(como(U.ana, `select public.definir_consentimento('privacidade', false, 'v2')`), /desconhecida/);
  await falha(como(U.ana, `select public.definir_consentimento('marketing', false, 'v2', $1)`, [D.carla]), /restrito à equipe/);
  const atuais = await como(U.ana, 'select tipo, aceito from public.consentimentos_atuais order by tipo');
  assert.deepEqual(atuais.rows, [{ tipo: 'lembretes', aceito: false }, { tipo: 'marketing', aceito: true }, { tipo: 'privacidade', aceito: true }]);
  assert.equal((await um(`select count(*)::int n from public.consentimentos where cliente_id = $1 and tipo = 'lembretes'`, [D.ana])).n, 2);
  await como(U.atendente, `select public.definir_consentimento('marketing', true, 'v2', $1, 'telefone')`, [D.carla]);
  assert.equal((await um(`select canal from public.consentimentos_atuais where cliente_id = $1 and tipo = 'marketing'`, [D.carla])).canal, 'telefone');
  // o cliente não lê preferências de outros
  assert.equal((await como(U.ana, 'select count(*)::int n from public.consentimentos_atuais where cliente_id = $1', [D.carla])).rows[0].n, 0);
});

test('equipe abre solicitação pelo balcão com as mesmas regras do site', async () => {
  const args = [D.carla, D.veiculoCarla, 'freios', 'Freio traseiro rangendo muito', ['freio-fraco'], 'ontem', 9100, 'manhã', 'balcao'];
  const sql = 'select * from public.abrir_solicitacao_equipe($1, $2, $3, $4, $5, $6, $7, $8, $9)';
  await falha(como(U.ana, sql, args), /restrito à equipe/);
  await falha(como(U.atendente, sql, [D.carla, D.veiculoAna, ...args.slice(2)]), /não encontrada no cadastro/);
  await falha(como(U.atendente, sql, [...args.slice(0, 6), 100, ...args.slice(7)]), /quilometragem/);
  await falha(como(U.atendente, sql, [...args.slice(0, 8), 'site']), /por onde/);
  const s = (await como(U.atendente, sql, args)).rows[0];
  assert.match(s.protocolo, /^MS-\d{4}-\d{6}$/);
  assert.equal(s.sintoma_risco, true);
  const ev = await um('select canal, descricao, autor_id from public.solicitacao_eventos where solicitacao_id = $1', [s.id]);
  assert.deepEqual(ev, { canal: 'balcao', descricao: 'Solicitação registrada pela oficina (balcao)', autor_id: U.atendente });
  D.solCarla = s.id;
  // pelo site continua igual
  const site = (await como(U.ana, `select * from public.criar_solicitacao($1, 'motor', 'Motor falhando na partida', '{falhando}', null, 15100, null)`, [D.veiculoAna])).rows[0];
  D.solAna = site.id;
  assert.equal((await um('select canal from public.solicitacao_eventos where solicitacao_id = $1', [site.id])).canal, 'site');
});

test('cliente do balcão liga o cadastro ao login pelo e-mail informado, ou pela equipe', async () => {
  // Carla foi cadastrada com carla@exemplo.test: ao criar o cadastro pelo site, o banco liga sozinho
  const id = (await como(U.carla, `select public.registrar_cliente('Carla B', '13933330000', null, 'whatsapp', true, false, 'v1') id`)).rows[0].id;
  assert.equal(id, D.carla);
  assert.equal((await como(U.carla, 'select count(*)::int n from public.solicitacoes')).rows[0].n, 1);
  // sem e-mail igual, não liga: precisa da equipe
  const bia = (await balcao(U.atendente, '13944440000', { nome: 'Bia Sem Email' })).rows[0].id;
  await falha(como(U.novo, `select public.registrar_cliente('Bia', '13944440000', null, 'whatsapp', true, false, 'v1')`), /Fale com a oficina/);
  await falha(como(U.ana, 'select public.vincular_login_cliente($1, $2)', [bia, 'novo@exemplo.test']), /restrito à equipe/);
  await falha(como(U.atendente, 'select public.vincular_login_cliente($1, $2)', [bia, 'ana@exemplo.test']), /outro cadastro/);
  await falha(como(U.atendente, 'select public.vincular_login_cliente($1, $2)', [bia, 'admin@exemplo.test']), /equipe/);
  await como(U.atendente, 'select public.vincular_login_cliente($1, $2)', [bia, 'novo@exemplo.test']);
  assert.equal((await como(U.novo, 'select id from public.clientes')).rows[0].id, bia);
  await falha(como(U.atendente, 'select public.vincular_login_cliente($1, $2)', [bia, 'novo@exemplo.test']), /já tem login/);
});

test('fotos e vídeos: arquivo privado, só o dono da solicitação e a equipe enviam e veem', async () => {
  const foto = `${D.solAna}/a1b2c3.jpg`;
  const subir = (quem, nome) => como(quem, `insert into storage.objects (bucket_id, name) values ('anexos', $1)`, [nome]);
  // Carla não envia para a solicitação da Ana, nem com nome fora do padrão
  await falha(subir(U.carla, foto), /row-level security/);
  await falha(subir(U.ana, `${D.solAna}/../x.jpg`), /row-level security/);
  await falha(subir(U.ana, `${D.solAna}/foto.exe`), /row-level security/);
  await falha(como(null, `insert into storage.objects (bucket_id, name) values ('anexos', $1)`, [foto]), /permission denied/);
  // registrar sem o arquivo ter chegado falha
  await falha(como(U.ana, `select public.registrar_anexo($1, $2, 'foto', 1000)`, [D.solAna, foto]), /não chegou/);
  await subir(U.ana, foto);
  await falha(como(U.ana, `select public.registrar_anexo($1, $2, 'foto', 1000)`, [D.solCarla, foto]), /não encontrada/);
  await falha(como(U.ana, `select public.registrar_anexo($1, $2, 'audio', 1000)`, [D.solAna, foto]), /foto ou um vídeo/);
  await como(U.ana, `select public.registrar_anexo($1, $2, 'foto', 1000)`, [D.solAna, foto]);
  // leitura: dono e equipe sim; outro cliente não
  assert.equal((await como(U.ana, `select count(*)::int n from storage.objects where bucket_id = 'anexos'`)).rows[0].n, 1);
  assert.equal((await como(U.especialista, `select count(*)::int n from storage.objects where bucket_id = 'anexos'`)).rows[0].n, 1);
  assert.equal((await como(U.carla, `select count(*)::int n from storage.objects where bucket_id = 'anexos'`)).rows[0].n, 0);
  assert.equal((await como(U.carla, 'select count(*)::int n from public.anexos')).rows[0].n, 0);
  assert.equal((await como(U.ana, 'select count(*)::int n from public.anexos')).rows[0].n, 1);
  // equipe anexa vídeo na solicitação aberta no balcão
  const video = `${D.solCarla}/v9.mp4`;
  await subir(U.atendente, video);
  await como(U.atendente, `select public.registrar_anexo($1, $2, 'video', 5000000)`, [D.solCarla, video]);
  assert.equal((await como(U.carla, 'select tipo from public.anexos')).rows[0].tipo, 'video');
});

test('limite de 10 arquivos por solicitação', async () => {
  for (let i = 2; i <= 10; i++) {
    const nome = `${D.solAna}/f${i}.png`;
    await como(U.ana, `insert into storage.objects (bucket_id, name) values ('anexos', $1)`, [nome]);
    await como(U.ana, `select public.registrar_anexo($1, $2, 'foto', 10)`, [D.solAna, nome]);
  }
  const extra = `${D.solAna}/f11.png`;
  await como(U.ana, `insert into storage.objects (bucket_id, name) values ('anexos', $1)`, [extra]);
  await falha(como(U.ana, `select public.registrar_anexo($1, $2, 'foto', 10)`, [D.solAna, extra]), /Limite de 10/);
});
