'use client';
import { useActionState, useState } from 'react';
import { registrarCliente, cadastrarVeiculo, criarSolicitacao, salvarPreferencias } from './actions';
import { CANAIS_EQUIPE, type Resultado } from '@/lib/validacao';

type Acao = (estado: Resultado | null, form: FormData) => Promise<Resultado>;

function Retorno({ estado }: { estado: Resultado | null }) {
  if (!estado) return null;
  return estado.ok
    ? <p className="ok-box small" role="status">{estado.mensagem}</p>
    : <p className="err" role="alert">{estado.erro}</p>;
}

export function CadastroForm({ utm }: { utm: Record<string, string> }) {
  const [estado, acao, pendente] = useActionState(registrarCliente, null);
  return (
    <form action={acao} className="panel stack" noValidate>
      <p className="label">Primeiro acesso</p>
      <h3>Seu cadastro</h3>
      <label className="f">Nome completo<input id="nome" name="nome" autoComplete="name" required /></label>
      <div className="grid2">
        <label className="f">Telefone com DDD<input id="telefone" name="telefone" inputMode="tel" placeholder="(13) 91234-5678" required /></label>
        <label className="f">E-mail (opcional)<input id="email-contato" name="email" type="email" /></label>
      </div>
      <div className="grid2">
        <label className="f">Prefere contato por
          <select id="preferencia" name="preferencia" defaultValue="whatsapp"><option value="whatsapp">WhatsApp</option><option value="email">E-mail</option><option value="telefone">Ligação</option></select>
        </label>
        <label className="f">Como conheceu a oficina
          <select id="origem" name="origem" defaultValue={utm.utm_source === 'instagram' ? 'instagram' : 'site'}>
            <option value="instagram">Instagram</option><option value="anuncio">Anúncio</option><option value="google">Google</option>
            <option value="indicacao">Indicação</option><option value="whatsapp">WhatsApp</option><option value="site">Site</option><option value="outro">Outro</option>
          </select>
        </label>
      </div>
      {Object.entries(utm).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <label className="check"><input id="aceitePrivacidade" type="checkbox" name="aceitePrivacidade" /> <span>Li o aviso de privacidade e concordo com o uso dos meus dados para o atendimento da minha moto.</span></label>
      <label className="check"><input id="aceiteLembretes" type="checkbox" name="aceiteLembretes" /> <span>Aceito receber lembretes de manutenção (opcional).</span></label>
      <label className="check"><input id="aceiteMarketing" type="checkbox" name="aceiteMarketing" /> <span>Aceito receber novidades e promoções da oficina (opcional).</span></label>
      <Retorno estado={estado} />
      <div><button className="btn primary" type="submit" disabled={pendente}>{pendente ? 'Salvando…' : 'Criar cadastro'}</button></div>
    </form>
  );
}

// Também usado pela equipe no balcão: aí recebe a ação do painel e o cliente escolhido.
export function VeiculoForm({ acao = cadastrarVeiculo, clienteId }: { acao?: Acao; clienteId?: string }) {
  const [estado, enviar, pendente] = useActionState(acao, null);
  const [aberto, setAberto] = useState(false);
  return (
    <form action={enviar} className="panel stack" noValidate key={estado?.ok ? Date.now() : 'f'}>
      <h3>Cadastrar scooter</h3>
      {clienteId && <input type="hidden" name="clienteId" value={clienteId} />}
      <div className="grid2">
        <label className="f">Marca<input id="marca" name="marca" placeholder="Ex.: Honda" /></label>
        <label className="f">Modelo<input id="modelo" name="modelo" placeholder="Ex.: PCX 160" /></label>
      </div>
      <div className="grid2">
        <label className="f">Ano de fabricação<input id="ano" name="ano" inputMode="numeric" placeholder="2022" /></label>
        <label className="f">Ano do modelo (se diferente)<input id="anoModelo" name="anoModelo" inputMode="numeric" placeholder="2023" /></label>
      </div>
      <div className="grid2">
        <label className="f">Quilometragem atual<input id="quilometragem" name="quilometragem" inputMode="numeric" placeholder="18400" /></label>
        <label className="f">Placa (só se necessário)<input id="placa" name="placa" /></label>
      </div>
      {aberto ? (
        <>
          <label className="f">Última manutenção (se souber)<input id="ultimaManutencao" name="ultimaManutencao" type="date" /></label>
          <label className="f">O que já foi feito na moto (opcional)<textarea id="historico" name="historico" rows={2} maxLength={2000} placeholder="Ex.: troca de óleo em maio, pneu traseiro novo" /></label>
          <label className="f">Observações (opcional)<textarea id="observacoes" name="observacoes" rows={2} maxLength={1000} placeholder="Ex.: arranhão no paralama, alarme instalado" /></label>
        </>
      ) : (
        <button type="button" className="btn small" style={{ alignSelf: 'flex-start' }} onClick={() => setAberto(true)}>Informar histórico e observações</button>
      )}
      <Retorno estado={estado} />
      <div><button className="btn primary" type="submit" disabled={pendente}>{pendente ? 'Salvando…' : 'Salvar scooter'}</button></div>
    </form>
  );
}

export function PreferenciasForm({ lembretes, marketing }: { lembretes: boolean; marketing: boolean }) {
  const [estado, enviar, pendente] = useActionState(salvarPreferencias, null);
  return (
    <form action={enviar} className="panel stack">
      <p className="label">Privacidade e avisos</p>
      <label className="check"><input type="checkbox" name="lembretes" defaultChecked={lembretes} /> <span>Lembretes de manutenção</span></label>
      <label className="check"><input type="checkbox" name="marketing" defaultChecked={marketing} /> <span>Novidades e promoções</span></label>
      <p className="small muted">Avisos sobre os seus pedidos continuam chegando. Você pode mudar isto quando quiser.</p>
      <Retorno estado={estado} />
      <div><button className="btn small" type="submit" disabled={pendente}>{pendente ? 'Salvando…' : 'Salvar preferências'}</button></div>
    </form>
  );
}

type Opcao = { id: string; rotulo: string; km: number };
type Servico = { slug: string; nome: string };
type Sintoma = { slug: string; texto: string; risco: boolean };

// clienteId preenchido = a equipe abrindo pelo cliente (balcão, telefone ou WhatsApp)
export function SolicitacaoForm({ veiculos, servicos, sintomas, acao: acaoForm = criarSolicitacao, clienteId }:
  { veiculos: Opcao[]; servicos: Servico[]; sintomas: Sintoma[]; acao?: Acao; clienteId?: string }) {
  const [estado, acao, pendente] = useActionState(acaoForm, null);
  const [marcados, setMarcados] = useState<string[]>([]);
  const [km, setKm] = useState(String(veiculos[0]?.km ?? ''));
  const risco = sintomas.some((s) => s.risco && marcados.includes(s.slug));
  return (
    <form action={acao} className="panel stack" noValidate>
      {clienteId && (
        <>
          <input type="hidden" name="clienteId" value={clienteId} />
          <label className="f">Pedido feito por
            <select name="canal" defaultValue="balcao">
              {Object.entries(CANAIS_EQUIPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
        </>
      )}
      <div className="grid2">
        <label className="f">Scooter
          <select id="veiculoId" name="veiculoId" onChange={(e) => setKm(String(veiculos.find((v) => v.id === e.target.value)?.km ?? ''))}>
            {veiculos.map((v) => <option key={v.id} value={v.id}>{v.rotulo}</option>)}
          </select>
        </label>
        <label className="f">Tipo de serviço
          <select id="servico" name="servico" defaultValue="diagnostico-scanner">
            {servicos.map((s) => <option key={s.slug} value={s.slug}>{s.nome}</option>)}
          </select>
        </label>
      </div>
      <label className="f">O que está acontecendo?<textarea id="descricao" name="descricao" placeholder="Ex.: barulho ao frear, principalmente na roda traseira." /></label>
      <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="label" style={{ marginBottom: 6 }}>Sintomas percebidos</legend>
        <div className="grid2">
          {sintomas.map((s) => (
            <label key={s.slug} className="check">
              <input type="checkbox" name="sintomas" value={s.slug}
                onChange={(e) => setMarcados((m) => e.target.checked ? [...m, s.slug] : m.filter((x) => x !== s.slug))} /> <span>{s.texto}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {risco && <div className="note crit" role="alert">Este sintoma pode afetar a segurança. Por precaução, evite rodar com a moto até receber orientação da oficina. Isto não é um diagnóstico.</div>}
      <div className="grid2">
        <label className="f">Quando começou<input id="inicioProblema" name="inicioProblema" placeholder="Ex.: há uma semana" /></label>
        <label className="f">Quilometragem atual<input id="km" name="quilometragem" inputMode="numeric" value={km} onChange={(e) => setKm(e.target.value)} /></label>
      </div>
      <label className="f">Melhor período para trazer a moto (opcional)<input id="disponibilidade" name="disponibilidade" placeholder="Ex.: manhãs, depois das 9h" /></label>
      {!clienteId && <p className="small muted">Depois de enviar, você poderá anexar fotos ou vídeos do problema.</p>}
      <Retorno estado={estado} />
      <div><button className="btn primary" type="submit" disabled={pendente}>{pendente ? 'Enviando…' : 'Enviar solicitação'}</button></div>
    </form>
  );
}
