'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseNavegador } from '@/lib/supabase/client';
import { registrarAnexo } from '@/lib/acoes-anexos';
import { EXTENSOES_ANEXO, LIMITE_ANEXO_BYTES } from '@/lib/validacao';
import type { Anexo } from '@/lib/anexos';

const LIMITE_ARQUIVOS = 10;

export function Anexos({ solicitacaoId, anexos, podeEnviar }: { solicitacaoId: string; anexos: Anexo[]; podeEnviar: boolean }) {
  const router = useRouter();
  const entrada = useRef<HTMLInputElement>(null);
  const [situacao, setSituacao] = useState<{ erro?: string; texto?: string }>({});
  const [enviando, setEnviando] = useState(false);

  async function enviar(arquivos: FileList | null) {
    if (!arquivos?.length) return;
    if (anexos.length + arquivos.length > LIMITE_ARQUIVOS) {
      setSituacao({ erro: `Limite de ${LIMITE_ARQUIVOS} arquivos por solicitação.` });
      return;
    }
    setEnviando(true);
    setSituacao({});
    const supabase = supabaseNavegador();
    let enviados = 0;
    for (const arquivo of Array.from(arquivos)) {
      const ext = arquivo.name.split('.').pop()?.toLowerCase() ?? '';
      const tipo = EXTENSOES_ANEXO[ext];
      if (!tipo) { setSituacao({ erro: `${arquivo.name}: envie foto (JPG, PNG, WEBP, HEIC) ou vídeo (MP4, MOV).` }); break; }
      if (arquivo.size > LIMITE_ANEXO_BYTES) { setSituacao({ erro: `${arquivo.name}: arquivo acima de 50 MB.` }); break; }
      setSituacao({ texto: `Enviando ${arquivo.name}…` });
      const caminho = `${solicitacaoId}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from('anexos').upload(caminho, arquivo, { contentType: arquivo.type || undefined, upsert: false });
      if (error) { setSituacao({ erro: `Não foi possível enviar ${arquivo.name}. Tente de novo.` }); break; }
      const r = await registrarAnexo({ solicitacaoId, caminho, tipo, tamanho: arquivo.size });
      if (!r.ok) { setSituacao({ erro: r.erro }); break; }
      enviados++;
    }
    setEnviando(false);
    if (entrada.current) entrada.current.value = '';
    if (enviados) {
      setSituacao((s) => (s.erro ? s : { texto: enviados === 1 ? 'Arquivo enviado.' : `${enviados} arquivos enviados.` }));
      router.refresh();
    }
  }

  return (
    <div className="stack">
      <p className="label">Fotos e vídeos</p>
      {anexos.length ? (
        <div className="anexos">
          {anexos.map((a) => a.url ? (
            a.tipo === 'foto'
              ? <a key={a.id} href={a.url} target="_blank" rel="noreferrer"><img src={a.url} alt="Foto enviada" loading="lazy" /></a>
              : <video key={a.id} src={a.url} controls preload="metadata" />
          ) : <span key={a.id} className="small muted">Arquivo indisponível</span>)}
        </div>
      ) : <p className="small muted">Nenhum arquivo enviado.</p>}
      {podeEnviar && anexos.length < LIMITE_ARQUIVOS && (
        <label className="btn small" style={{ alignSelf: 'flex-start' }}>
          {enviando ? 'Enviando…' : 'Adicionar fotos ou vídeos'}
          <input ref={entrada} type="file" accept="image/jpeg,image/png,image/webp,image/heic,video/mp4,video/quicktime" multiple hidden
            disabled={enviando} onChange={(e) => enviar(e.target.files)} />
        </label>
      )}
      {situacao.erro && <p className="err" role="alert">{situacao.erro}</p>}
      {!situacao.erro && situacao.texto && <p className="small" role="status">{situacao.texto}</p>}
      {podeEnviar && <p className="small muted">Até {LIMITE_ARQUIVOS} arquivos de 50 MB cada. Só você e a equipe da oficina veem.</p>}
    </div>
  );
}
