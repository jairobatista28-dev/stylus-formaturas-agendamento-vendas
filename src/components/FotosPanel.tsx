import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, ClipboardCopy, Image as ImageIcon, RefreshCw, Save } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface FotosConfig {
  fotos_ativas: boolean;
  fotos_visualizacao_unica: boolean;
  fotos_frase: string;
}

const MOTIVOS_FOTO: Record<string, string> = {
  login_falhou: 'Não conseguiu entrar no Meus Álbuns (confira os secrets de login)',
  turma_nao_encontrada: 'Turma (contrato) não encontrada no Meus Álbuns',
  nome_nao_encontrado_na_turma: 'Nome não encontrado nessa turma do Meus Álbuns',
  nome_ambiguo: 'Mais de um aluno com nome parecido: não enviado por segurança',
  fotos_indisponiveis: 'Fotos indisponíveis (podem ter sido recicladas)',
  download_falhou: 'Não conseguiu baixar as fotos',
  nenhuma_foto_adequada: 'A IA não achou uma foto adequada',
  turma_nao_sincronizada: 'Turma ainda não sincronizada: rode a sincronização de fotos (card Foto do formando)',
  foto_ja_enviada: 'Esse formando já recebeu a foto',
  envio_falhou: 'Falha ao enviar pelo WhatsApp',
  contato_nao_encontrado: 'Contato não encontrado',
  fotos_desativadas: 'Envio de fotos desativado',
};

/**
 * Codigo que roda no Console do Meus Albuns (ja logado): le as fotos dos formandos
 * das campanhas de venda e grava no Supabase. So precisa rodar quando entram turmas novas.
 */
function montarCodigoSincronizacao(urlFuncao: string): string {
  return `(async () => {
const FN = ${JSON.stringify(urlFuncao)};
const box = document.createElement('div');
box.style.cssText = 'position:fixed;top:16px;right:16px;z-index:999999;background:#111827;color:#fff;padding:16px 20px;border-radius:12px;font:14px sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.4);max-width:360px';
document.body.appendChild(box);
const msg = (t) => { box.innerHTML = '<b>Sincronizando fotos (Stylus)</b><br><br>' + t; };
try {
  const ck = document.cookie.split('; ').find((c) => c.startsWith('user_offline='));
  if (!ck) { msg('Faça login no Meus Álbuns e rode o código de novo.'); return; }
  const bruto = ck.slice(13);
  let conta; try { conta = JSON.parse(bruto); } catch { conta = JSON.parse(decodeURIComponent(bruto)); }
  const token = conta.Token;
  const post = (b) => fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...b, token_conta: token }) }).then((r) => r.json());
  msg('Consultando quais turmas são necessárias...');
  const nec = await post({ acao: 'pits_necessarios' });
  if (!nec.success) { msg('Erro: ' + (nec.motivo || 'falha') + '. Confira os secrets no Supabase.'); return; }
  msg('Lendo a lista de alunos...');
  const lista = await fetch('/api/Alunos/ListIncremental?alunoTurmaID=0', { headers: { Authtoken: token, Authtype: 'Token' } }).then((r) => r.json());
  const ja = new Set(nec.sincronizados);
  const alvo = lista.filter((a) => nec.pits.includes(String(a.PIT)) && !ja.has(a.AlunoTurmaID_Cript));
  if (!alvo.length) { msg('Tudo em dia! Nenhum formando novo para sincronizar.'); setTimeout(() => box.remove(), 6000); return; }
  const lerFotos = (html) => {
    const ini = html.search(/var\\s+oPhotos\\s*=\\s*\\[/); if (ini < 0) return null;
    const abre = html.indexOf('[', ini); let n = 0, str = false, esc = false, fim = -1;
    for (let i = abre; i < html.length; i++) { const c = html[i];
      if (str) { if (esc) esc = false; else if (c === '\\\\') esc = true; else if (c === '"') str = false; continue; }
      if (c === '"') str = true; else if (c === '[') n++; else if (c === ']') { n--; if (!n) { fim = i; break; } } }
    const tk = (html.match(/var\\s+token\\s*=\\s*"([^"]+)"/) || [])[1];
    try { return { fotos: JSON.parse(html.slice(abre, fim + 1)), token: tk }; } catch { return null; }
  };
  const escolher = (fotos) => {
    const v = fotos.filter((f) => f.RenderMain && !f.FlBrinde);
    const vert = v.filter((f) => (f.Height || 0) > (f.Width || 0));
    const base = vert.length >= 3 ? vert : v;
    if (base.length <= 15) return base;
    const p = base.length / 15; return Array.from({ length: 15 }, (_, i) => base[Math.floor(i * p + p / 2)]);
  };
  let feitos = 0, ok = 0, falhas = 0, buffer = [];
  const enviar = async () => { if (!buffer.length) return; const b = buffer; buffer = []; await post({ acao: 'sincronizar', alunos: b }); };
  const fila = alvo.slice();
  const worker = async () => {
    while (fila.length) {
      const a = fila.shift();
      try {
        const html = await fetch('/Produtos?a=' + encodeURIComponent(a.AlunoTurmaID_Cript) + '&fotos=true').then((r) => r.text());
        const r = lerFotos(html);
        if (r && r.token && r.fotos.length) {
          buffer.push({ cript: a.AlunoTurmaID_Cript, nome: a.NomeAluno, pit: String(a.PIT), qtd: a.QtdFotos, token: r.token,
            fotos: escolher(r.fotos).map((f) => ({ h: f.RenderMain, w: f.Width, a: f.Height })) });
          ok++;
        } else falhas++;
      } catch { falhas++; }
      feitos++;
      msg(feitos + ' de ' + alvo.length + ' formandos<br>✅ ' + ok + ' com fotos · ⚠️ ' + falhas + ' sem fotos (podem ter sido recicladas)');
      if (buffer.length >= 5) await enviar();
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  await enviar();
  msg('Concluído! ✅ ' + ok + ' formandos sincronizados · ⚠️ ' + falhas + ' sem fotos.<br><br>Pode fechar esta aba.');
} catch (e) { msg('Erro: ' + (e && e.message ? e.message : e)); }
})();`;
}

export function motivoFotoLegivel(m?: string | null): string {
  return (m && MOTIVOS_FOTO[m]) || m || 'Erro desconhecido';
}

export function FotosPanel({ onToast }: { onToast: (msg: string, tipo: 'success' | 'error') => void }) {
  const [cfg, setCfg] = useState<FotosConfig | null>(null);
  const [aberto, setAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [testando, setTestando] = useState(false);
  const [resultadoTeste, setResultadoTeste] = useState<{ ok: boolean; total: number; log: string[] } | null>(null);
  const [statusSync, setStatusSync] = useState<{ total: number; ultima: string | null } | null>(null);

  async function carregarStatusSync() {
    const { data } = await supabase.functions.invoke('fotos-formando', { body: { acao: 'status_sync' } });
    if (data?.success) setStatusSync({ total: data.total, ultima: data.ultima });
  }

  async function copiarCodigo() {
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fotos-formando`;
    await navigator.clipboard.writeText(montarCodigoSincronizacao(url));
    onToast('Código copiado! Cole no Console do Meus Álbuns (F12 > Console)', 'success');
  }

  useEffect(() => {
    supabase
      .from('resgate_config')
      .select('fotos_ativas, fotos_visualizacao_unica, fotos_frase')
      .eq('id', 1)
      .maybeSingle()
      .then(({ data }) => data && setCfg(data as FotosConfig));
    carregarStatusSync();
  }, []);

  async function salvar(parcial?: Partial<FotosConfig>) {
    if (!cfg) return;
    const novo = { ...cfg, ...parcial };
    setSalvando(true);
    const { error } = await supabase
      .from('resgate_config')
      .update({ fotos_ativas: novo.fotos_ativas, fotos_visualizacao_unica: novo.fotos_visualizacao_unica, fotos_frase: novo.fotos_frase })
      .eq('id', 1);
    setSalvando(false);
    if (error) {
      onToast('Erro ao salvar: ' + error.message, 'error');
      return;
    }
    setCfg(novo);
    onToast(parcial && 'fotos_ativas' in parcial ? (novo.fotos_ativas ? 'Envio de fotos ATIVADO' : 'Envio de fotos pausado') : 'Configuração salva', 'success');
  }

  async function testar() {
    setTestando(true);
    setResultadoTeste(null);
    const { data, error } = await supabase.functions.invoke('fotos-formando', { body: { acao: 'testar' } });
    setTestando(false);
    if (error || !data) {
      // Mostra o detalhe do erro do servidor no painel (em vez de so um aviso generico)
      let detalhe = error?.message || 'sem resposta';
      try {
        const corpo = await (error as any)?.context?.json?.();
        if (corpo?.error) detalhe = corpo.error;
      } catch {
        /* ignora */
      }
      setResultadoTeste({ ok: false, total: 0, log: [`Erro no servidor: ${detalhe}`] });
      onToast('Erro ao testar conexão', 'error');
      return;
    }
    setResultadoTeste({ ok: !!data.success, total: data.total_alunos || 0, log: data.log || [] });
  }

  if (!cfg) return null;

  return (
    <div className="rounded-xl p-4" style={{ border: '1px solid var(--border-subtle)', backgroundColor: 'var(--bg-surface)' }}>
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: cfg.fotos_ativas ? 'var(--success)' : 'var(--bg-surface-raised)' }}>
            <ImageIcon size={18} style={{ color: cfg.fotos_ativas ? 'white' : 'var(--text-muted)' }} />
          </div>
          <div>
            <p className="font-medium" style={{ color: 'var(--text-primary)' }}>
              Foto do formando {cfg.fotos_ativas ? '· ativo' : '· pausado'}
            </p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {statusSync
                ? `${statusSync.total} formandos com fotos sincronizadas${statusSync.ultima ? ` · última sincronização ${new Date(statusSync.ultima).toLocaleString('pt-BR')}` : ''}`
                : 'A IA envia uma foto do formando (Meus Álbuns) no melhor momento da negociação · uma vez por formando'}
              <button onClick={carregarStatusSync} title="Atualizar" style={{ marginLeft: 6, verticalAlign: 'middle' }}>
                <RefreshCw size={12} />
              </button>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={copiarCodigo} className="btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }} title="Copia o código de sincronização para colar no Console do Meus Álbuns">
            <ClipboardCopy size={14} /> Copiar código de sincronização
          </button>
          <button
            onClick={() => salvar({ fotos_ativas: !cfg.fotos_ativas })}
            disabled={salvando}
            className={cfg.fotos_ativas ? 'btn-secondary' : 'btn-primary'}
            style={{ padding: '6px 12px', fontSize: '12px' }}
          >
            {cfg.fotos_ativas ? 'Pausar' : 'Ativar'}
          </button>
          <button onClick={() => setAberto(!aberto)} className="btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }}>
            Detalhes {aberto ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>

      {resultadoTeste && (
        <div className="mt-3 p-3 rounded-lg text-xs space-y-1" style={{ backgroundColor: 'var(--bg-surface-raised)' }}>
          <p style={{ color: resultadoTeste.ok ? 'var(--success)' : 'var(--warning)', fontWeight: 600 }}>
            {resultadoTeste.ok ? `Conectado ao Meus Álbuns · ${resultadoTeste.total} alunos encontrados` : 'Não foi possível conectar'}
          </p>
          {resultadoTeste.log.map((l, i) => (
            <p key={i} style={{ color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{l}</p>
          ))}
        </div>
      )}

      {aberto && (
        <div className="mt-4 pt-4 space-y-3" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <label className="flex flex-col gap-1">
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Frase que acompanha a foto ({'{nome}'} = primeiro nome)</span>
            <textarea
              value={cfg.fotos_frase}
              onChange={(e) => setCfg({ ...cfg, fotos_frase: e.target.value })}
              rows={3}
              className="input-dark"
              style={{ padding: '8px 10px' }}
            />
          </label>
          <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
            <input
              type="checkbox"
              checked={cfg.fotos_visualizacao_unica}
              onChange={(e) => setCfg({ ...cfg, fotos_visualizacao_unica: e.target.checked })}
            />
            Enviar em visualização única
          </label>
          <div className="text-xs p-3 rounded-lg space-y-1" style={{ backgroundColor: 'var(--bg-surface-raised)', color: 'var(--text-secondary)' }}>
            <p style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Como sincronizar as fotos (quando entrar turma nova)</p>
            <p>1. Clique em <b>Copiar código de sincronização</b> (botão acima).</p>
            <p>2. Abra o Meus Álbuns de Formatura já logado, aperte <b>F12</b> e vá na aba <b>Console</b>.</p>
            <p>3. Cole o código (Ctrl+V) e aperte <b>Enter</b>. Um quadro mostra o progresso; ao terminar, pode fechar.</p>
            <p>Só são lidos os formandos das campanhas de venda que ainda não compraram. Quem já foi sincronizado nos últimos 15 dias é pulado.</p>
            <button onClick={testar} disabled={testando} className="btn-secondary mt-2" style={{ padding: '4px 10px', fontSize: '12px' }}>
              {testando ? 'Testando...' : 'Testar login automático (diagnóstico)'}
            </button>
          </div>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            O sistema localiza o formando pelo contrato e pelo nome. Se houver dúvida (nomes parecidos na mesma turma), a foto não é
            enviada, para nunca mandar a foto de outra pessoa. Cada card abaixo tem os botões "Ver foto" (prévia, sem enviar) e
            "Enviar foto".
          </p>
          <button onClick={() => salvar()} disabled={salvando} className="btn-primary" style={{ padding: '6px 12px', fontSize: '12px' }}>
            <Save size={14} /> Salvar
          </button>
        </div>
      )}
    </div>
  );
}
