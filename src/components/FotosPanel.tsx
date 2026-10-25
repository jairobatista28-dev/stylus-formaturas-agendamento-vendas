import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Image as ImageIcon, PlugZap, Save } from 'lucide-react';
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
  foto_ja_enviada: 'Esse formando já recebeu a foto',
  envio_falhou: 'Falha ao enviar pelo WhatsApp',
  contato_nao_encontrado: 'Contato não encontrado',
  fotos_desativadas: 'Envio de fotos desativado',
};

export function motivoFotoLegivel(m?: string | null): string {
  return (m && MOTIVOS_FOTO[m]) || m || 'Erro desconhecido';
}

export function FotosPanel({ onToast }: { onToast: (msg: string, tipo: 'success' | 'error') => void }) {
  const [cfg, setCfg] = useState<FotosConfig | null>(null);
  const [aberto, setAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [testando, setTestando] = useState(false);
  const [resultadoTeste, setResultadoTeste] = useState<{ ok: boolean; total: number; log: string[] } | null>(null);

  useEffect(() => {
    supabase
      .from('resgate_config')
      .select('fotos_ativas, fotos_visualizacao_unica, fotos_frase')
      .eq('id', 1)
      .maybeSingle()
      .then(({ data }) => data && setCfg(data as FotosConfig));
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
              A IA envia uma foto do formando (Meus Álbuns) no melhor momento da negociação · uma vez por formando
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={testar} disabled={testando} className="btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }}>
            <PlugZap size={14} /> {testando ? 'Testando...' : 'Testar conexão'}
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
