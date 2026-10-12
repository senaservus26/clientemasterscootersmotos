'use client';
import { useActionState, useState } from 'react';
import { registrarCliente, cadastrarVeiculo, criarSolicitacao } from './actions';
import type { Resultado } from '@/lib/validacao';

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
      <Retorno estado={estado} />
      <div><button className="btn primary" type="submit" disabled={pendente}>{pendente ? 'Salvando…' : 'Criar cadastro'}</button></div>
    </form>
  );
}

export function VeiculoForm() {
  const [estado, acao, pendente] = useActionState(cadastrarVeiculo, null);
  return (
    <form action={acao} className="panel stack" noValidate key={estado?.ok ? Date.now() : 'f'}>
      <h3>Cadastrar scooter</h3>
      <div className="grid2">
        <label className="f">Marca<input id="marca" name="marca" placeholder="Ex.: Honda" /></label>
        <label className="f">Modelo<input id="modelo" name="modelo" placeholder="Ex.: PCX 160" /></label>
      </div>
      <div className="grid2">
        <label className="f">Ano<input id="ano" name="ano" inputMode="numeric" placeholder="2022" /></label>
        <label className="f">Quilometragem atual<input id="quilometragem" name="quilometragem" inputMode="numeric" placeholder="18400" /></label>
      </div>
      <div className="grid2">
        <label className="f">Placa (só se necessário)<input id="placa" name="placa" /></label>
        <label className="f">Última manutenção (se souber)<input id="ultimaManutencao" name="ultimaManutencao" type="date" /></label>
      </div>
      <Retorno estado={estado} />
      <div><button className="btn primary" type="submit" disabled={pendente}>{pendente ? 'Salvando…' : 'Salvar scooter'}</button></div>
    </form>
  );
}

type Opcao = { id: string; rotulo: string; km: number };
type Servico = { slug: string; nome: string };
type Sintoma = { slug: string; texto: string; risco: boolean };

export function SolicitacaoForm({ veiculos, servicos, sintomas }: { veiculos: Opcao[]; servicos: Servico[]; sintomas: Sintoma[] }) {
  const [estado, acao, pendente] = useActionState(criarSolicitacao, null);
  const [marcados, setMarcados] = useState<string[]>([]);
  const [km, setKm] = useState(String(veiculos[0]?.km ?? ''));
  const risco = sintomas.some((s) => s.risco && marcados.includes(s.slug));
  return (
    <form action={acao} className="panel stack" noValidate>
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
      <label className="f">Disponibilidade (opcional)<input id="disponibilidade" name="disponibilidade" placeholder="Ex.: manhãs, depois das 9h" /></label>
      <Retorno estado={estado} />
      <div><button className="btn primary" type="submit" disabled={pendente}>{pendente ? 'Enviando…' : 'Enviar solicitação'}</button></div>
    </form>
  );
}
