import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * FOTO DO FORMANDO (Meus Albuns de Formatura -> WhatsApp)
 *
 * Fluxo:
 *  1. Login no site com MEUSALBUNS_EMAIL / MEUSALBUNS_SENHA (secrets)
 *  2. Lista de alunos: GET /api/Alunos/ListIncremental?alunoTurmaID=0 (cache 12h)
 *  3. Acha o formando pelo contrato (PIT = contrato sem barra) + nome
 *  4. Pagina de fotos: GET /Produtos?a=<AlunoTurmaID_Cript>&fotos=true -> oPhotos + token
 *  5. Foto: /ImageFormatura/?hash=<RenderMain>&t=<token> (abre sem login, ja com marca d'agua)
 *  6. Gemini escolhe a melhor entre algumas fotos verticais
 *  7. Envia pela Uazapi (visualizacao unica, se habilitado) com a frase configurada
 *
 * Acoes: testar | previa | enviar
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

const BASE = 'https://www.meusalbunsdeformatura.com.br';
const BRAND_ID = 145;
const CACHE_HORAS = 12;
const MAX_CANDIDATAS = 6;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

// ============================================================================
// SESSAO (cookies) NO SITE
// ============================================================================

/** Esconde valores longos (tokens) e qualquer campo de senha antes de mostrar no log */
function mascarar(texto: string): string {
  return String(texto || '')
    .replace(/\s+/g, ' ')
    .replace(/("?(senha|password|pass)"?\s*[:=]\s*)"[^"]*"/gi, '$1"***"')
    .replace(/[A-Za-z0-9+/=_-]{40,}/g, (m) => `${m.slice(0, 6)}...(${m.length})`);
}

class Sessao {
  cookies = new Map<string, string>();
  log: string[] = [];

  guardarCookies(res: Response) {
    // deno-lint-ignore no-explicit-any
    const lista: string[] = (res.headers as any).getSetCookie?.() || [];
    for (const c of lista) {
      const [par] = c.split(';');
      const i = par.indexOf('=');
      if (i > 0) this.cookies.set(par.slice(0, i).trim(), par.slice(i + 1).trim());
    }
  }

  cabecalhoCookie(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  /** fetch que guarda cookies e segue redirecionamentos manualmente (mantendo os cookies) */
  async req(url: string, init: RequestInit = {}, maxRedirects = 5): Promise<Response> {
    let atual = url.startsWith('http') ? url : BASE + url;
    let opcoes: RequestInit = init;
    for (let i = 0; i <= maxRedirects; i++) {
      const headers = new Headers(opcoes.headers || {});
      headers.set('User-Agent', UA);
      headers.set('Referer', `${BASE}/Painel`);
      if (this.cookies.size) headers.set('Cookie', this.cabecalhoCookie());
      const res = await fetch(atual, { ...opcoes, headers, redirect: 'manual' });
      this.guardarCookies(res);
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        atual = new URL(res.headers.get('location')!, atual).toString();
        opcoes = { method: 'GET' };
        continue;
      }
      return res;
    }
    throw new Error('Redirecionamentos demais');
  }

  async login(): Promise<boolean> {
    const email = Deno.env.get('MEUSALBUNS_EMAIL')?.trim();
    const senha = Deno.env.get('MEUSALBUNS_SENHA');
    if (!email || !senha) {
      this.log.push('Secrets MEUSALBUNS_EMAIL / MEUSALBUNS_SENHA nao configurados');
      return false;
    }

    const r1 = await this.req('/Login/');
    this.log.push(`GET /Login/ -> ${r1.status}`);
    await r1.body?.cancel();

    const r2 = await this.req(`/api/Login/VerifyLogin?login=${encodeURIComponent(email)}`, {
      method: 'POST',
      headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' },
    });
    this.log.push(`VerifyLogin -> ${r2.status}`);
    await r2.body?.cancel();

    const r3 = await this.req('/Login/ValidarLogin', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        Accept: 'application/json, text/javascript, */*; q=0.01',
      },
      body: JSON.stringify({ email, senha, brand_id: BRAND_ID }),
    });
    const corpo = await r3.text();
    this.log.push(`ValidarLogin -> ${r3.status} | cookies: ${[...this.cookies.keys()].join(', ') || 'nenhum'}`);
    this.log.push(`ValidarLogin resposta: ${mascarar(corpo).slice(0, 300)}`);
    this.log.push(`ValidarLogin cabecalhos: ${[...r3.headers.keys()].join(', ')}`);
    return r3.ok;
  }
}

// ============================================================================
// ALUNOS E FOTOS
// ============================================================================

interface AlunoMA {
  NomeAluno: string;
  PIT: string;
  QtdFotos: number;
  AlunoTurmaID: number;
  AlunoTurmaID_Cript: string;
  NomeTurma?: string;
}

interface FotoMA {
  RenderMain: string;
  Width: number;
  Height: number;
  FlBrinde?: boolean;
  Nome?: string;
}

async function listarAlunos(sb: any, sessao: Sessao, forcar = false): Promise<AlunoMA[]> {
  if (!forcar) {
    const { data: cache } = await sb.from('meusalbuns_cache').select('valor, atualizado_em').eq('chave', 'alunos').maybeSingle();
    if (cache && Date.now() - new Date(cache.atualizado_em).getTime() < CACHE_HORAS * 3600000) {
      return cache.valor as AlunoMA[];
    }
  }
  const res = await sessao.req('/api/Alunos/ListIncremental?alunoTurmaID=0', {
    headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' },
  });
  const texto = await res.text();
  sessao.log.push(`ListIncremental -> ${res.status} (${Math.round(texto.length / 1024)} kB)`);
  let bruto: any = null;
  try {
    bruto = JSON.parse(texto);
  } catch {
    sessao.log.push(`ListIncremental nao retornou JSON: ${mascarar(texto).slice(0, 300)}`);
    return [];
  }
  // A lista pode vir direto (array) ou dentro de um objeto ({ data: [...] })
  let lista: any[] = [];
  if (Array.isArray(bruto)) lista = bruto;
  else if (bruto && typeof bruto === 'object') {
    const chave = Object.keys(bruto).find((k) => Array.isArray(bruto[k]));
    if (chave) lista = bruto[chave];
  }
  if (!lista.length) {
    sessao.log.push(`ListIncremental sem lista de alunos. Resposta: ${mascarar(texto).slice(0, 300)}`);
    return [];
  }
  const enxuta: AlunoMA[] = lista.map((a: any) => ({
    NomeAluno: a.NomeAluno,
    PIT: String(a.PIT || ''),
    QtdFotos: a.QtdFotos,
    AlunoTurmaID: a.AlunoTurmaID,
    AlunoTurmaID_Cript: a.AlunoTurmaID_Cript,
    NomeTurma: a.NomeTurma,
  }));
  await sb.from('meusalbuns_cache').upsert({ chave: 'alunos', valor: enxuta, atualizado_em: new Date().toISOString() });
  return enxuta;
}

function normalizarNome(n: string): string {
  return String(n || '')
    .toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/-\s*\d+\s*$/, '')          // "TALITA QUEIROZ-49" -> "TALITA QUEIROZ"
    .replace(/[^A-Z\s]/g, ' ')
    .replace(/\b(DE|DA|DO|DAS|DOS|E)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Acha o aluno com seguranca: mesma turma (contrato) e nome compativel.
 * Na duvida (dois candidatos parecidos), NAO escolhe - evita mandar foto de outra pessoa.
 */
function encontrarAluno(alunos: AlunoMA[], nome: string, contrato: string | null): { aluno: AlunoMA | null; motivo?: string } {
  const pit = String(contrato || '').replace(/\D/g, '');
  const alvo = normalizarNome(nome);
  const tokensAlvo = alvo.split(' ').filter(Boolean);
  if (!tokensAlvo.length) return { aluno: null, motivo: 'nome_vazio' };

  const daTurma = pit ? alunos.filter((a) => a.PIT === pit) : [];
  const universo = daTurma.length ? daTurma : alunos;

  const pontuar = (a: AlunoMA) => {
    const n = normalizarNome(a.NomeAluno);
    if (n === alvo) return 100;
    const t = n.split(' ');
    const comuns = tokensAlvo.filter((x) => t.includes(x)).length;
    const primeiroIgual = t[0] === tokensAlvo[0];
    const ultimoIgual = t[t.length - 1] === tokensAlvo[tokensAlvo.length - 1];
    if (primeiroIgual && ultimoIgual) return 80 + comuns;
    if (primeiroIgual && comuns >= 2) return 60 + comuns;
    return 0;
  };

  const ranking = universo.map((a) => ({ a, p: pontuar(a) })).filter((x) => x.p > 0).sort((x, y) => y.p - x.p);
  if (!ranking.length) return { aluno: null, motivo: daTurma.length ? 'nome_nao_encontrado_na_turma' : 'turma_nao_encontrada' };
  // Sem turma confirmada, so aceita nome identico
  if (!daTurma.length && ranking[0].p < 100) return { aluno: null, motivo: 'turma_nao_encontrada' };
  if (ranking.length > 1 && ranking[1].p === ranking[0].p) return { aluno: null, motivo: 'nome_ambiguo' };
  return { aluno: ranking[0].a };
}

/** Le a pagina de fotos do aluno e extrai oPhotos, token e urlRender */
async function carregarFotos(sessao: Sessao, aluno: AlunoMA): Promise<{ fotos: FotoMA[]; token: string; urlRender: string }> {
  const res = await sessao.req(`/Produtos?a=${encodeURIComponent(aluno.AlunoTurmaID_Cript)}&fotos=true`);
  const html = await res.text();
  sessao.log.push(`Pagina de fotos -> ${res.status} (${Math.round(html.length / 1024)} kB)`);

  const token = html.match(/var\s+token\s*=\s*"([^"]+)"/)?.[1] || '';
  const urlRender = html.match(/var\s+urlRender\s*=\s*"([^"]+)"/)?.[1] || `${BASE}/ImageFormatura`;

  // Extrai o array JSON de "var oPhotos = [...]" respeitando strings
  let fotos: FotoMA[] = [];
  const ini = html.search(/var\s+oPhotos\s*=\s*\[/);
  if (ini >= 0) {
    const abre = html.indexOf('[', ini);
    let nivel = 0, emString = false, escape = false, fim = -1;
    for (let i = abre; i < html.length; i++) {
      const ch = html[i];
      if (emString) {
        if (escape) escape = false;
        else if (ch === '\\') escape = true;
        else if (ch === '"') emString = false;
        continue;
      }
      if (ch === '"') emString = true;
      else if (ch === '[') nivel++;
      else if (ch === ']') { nivel--; if (nivel === 0) { fim = i; break; } }
    }
    if (fim > abre) {
      try {
        fotos = JSON.parse(html.slice(abre, fim + 1));
      } catch (e) {
        sessao.log.push(`Falha ao ler oPhotos: ${e instanceof Error ? e.message : e}`);
      }
    }
  }
  sessao.log.push(`Fotos encontradas: ${fotos.length} | token: ${token ? 'ok' : 'NAO ENCONTRADO'}`);
  return { fotos, token, urlRender };
}

function urlDaFoto(urlRender: string, foto: FotoMA, token: string): string {
  return `${urlRender.replace(/\/$/, '')}/?hash=${foto.RenderMain}&t=${token}`;
}

/** Escolhe ate MAX_CANDIDATAS fotos verticais, espalhadas pelo album */
function selecionarCandidatas(fotos: FotoMA[]): FotoMA[] {
  const validas = fotos.filter((f) => f.RenderMain && !f.FlBrinde);
  const verticais = validas.filter((f) => (f.Height || 0) > (f.Width || 0));
  const base = verticais.length >= 3 ? verticais : validas;
  if (base.length <= MAX_CANDIDATAS) return base;
  const passo = base.length / MAX_CANDIDATAS;
  return Array.from({ length: MAX_CANDIDATAS }, (_, i) => base[Math.floor(i * passo + passo / 2)]);
}

async function baixarImagem(url: string): Promise<{ base64: string; finalUrl: string } | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
    if (!res.ok) return null;
    const tipo = res.headers.get('content-type') || '';
    if (!tipo.includes('image')) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { base64: btoa(bin), finalUrl: res.url || url };
  } catch {
    return null;
  }
}

/** Gemini escolhe a melhor foto (formando sozinho, rosto visivel, de beca/diploma) */
async function escolherMelhor(imagens: string[], nome: string): Promise<{ indice: number; motivo: string }> {
  const chave = Deno.env.get('GEMINI_API_KEY');
  if (!chave || imagens.length <= 1) return { indice: 0, motivo: 'padrao' };
  const parts: any[] = imagens.map((b64) => ({ inline_data: { mime_type: 'image/jpeg', data: b64 } }));
  parts.push({
    text:
      `Estas sao ${imagens.length} fotos (indices 0 a ${imagens.length - 1}, na ordem) da formatura de ${nome}. ` +
      `Escolha a MELHOR para enviar a essa pessoa como previa: deve mostrar UMA pessoa em destaque (o/a formando/a), ` +
      `rosto bem visivel e bonito (olhos abertos, de preferencia sorrindo), de preferencia de beca, com diploma ou em pose individual. ` +
      `Evite fotos de grupo, borradas, de costas, de olhos fechados ou em que a pessoa aparece pequena. ` +
      `Responda SOMENTE JSON: {"indice": numero, "motivo": "frase curta"}. Se nenhuma servir, use {"indice": -1, "motivo": "..."}.`,
  });
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${chave}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseMimeType: 'application/json', temperature: 0 } }),
      }
    );
    if (!res.ok) return { indice: 0, motivo: `gemini_${res.status}` };
    const j = await res.json();
    const out = JSON.parse((j?.candidates?.[0]?.content?.parts?.[0]?.text || '{}').replace(/```json|```/g, '').trim());
    const idx = Number(out.indice);
    if (Number.isInteger(idx) && idx >= -1 && idx < imagens.length) return { indice: idx, motivo: String(out.motivo || '') };
  } catch (e) {
    console.warn('[Fotos] Gemini falhou:', e);
  }
  return { indice: 0, motivo: 'fallback' };
}

// ============================================================================
// FLUXO PRINCIPAL
// ============================================================================

function primeiroNome(nome?: string | null): string {
  const p = String(nome || '').trim().split(/\s+/)[0] || '';
  return p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : '';
}

async function prepararFoto(sb: any, contatoCampanhaId: string) {
  const sessao = new Sessao();
  const { data: cc } = await sb
    .from('contatos_campanha')
    .select('id, nome, telefone, numero_contrato, status, foto_enviada_em, meusalbuns_aluno')
    .eq('id', contatoCampanhaId)
    .maybeSingle();
  if (!cc) return { ok: false, motivo: 'contato_nao_encontrado', log: sessao.log };

  if (!(await sessao.login())) return { ok: false, motivo: 'login_falhou', log: sessao.log, cc };

  let alunos = await listarAlunos(sb, sessao);
  let achado = encontrarAluno(alunos, cc.nome, cc.numero_contrato);
  if (!achado.aluno) {
    // Pode ser aluno novo: renova o cache uma vez
    alunos = await listarAlunos(sb, sessao, true);
    achado = encontrarAluno(alunos, cc.nome, cc.numero_contrato);
  }
  if (!achado.aluno) return { ok: false, motivo: achado.motivo, log: sessao.log, cc };
  const aluno = achado.aluno;
  sessao.log.push(`Aluno: ${aluno.NomeAluno} (turma ${aluno.PIT}, ${aluno.QtdFotos} fotos)`);

  const { fotos, token, urlRender } = await carregarFotos(sessao, aluno);
  if (!fotos.length || !token) return { ok: false, motivo: 'fotos_indisponiveis', log: sessao.log, cc, aluno };

  const candidatas = selecionarCandidatas(fotos);
  const baixadas: Array<{ foto: FotoMA; base64: string; url: string }> = [];
  for (const f of candidatas) {
    const img = await baixarImagem(urlDaFoto(urlRender, f, token));
    if (img) baixadas.push({ foto: f, base64: img.base64, url: img.finalUrl });
  }
  sessao.log.push(`Candidatas baixadas: ${baixadas.length}/${candidatas.length}`);
  if (!baixadas.length) return { ok: false, motivo: 'download_falhou', log: sessao.log, cc, aluno };

  const escolha = await escolherMelhor(baixadas.map((b) => b.base64), aluno.NomeAluno);
  if (escolha.indice === -1) return { ok: false, motivo: 'nenhuma_foto_adequada', log: sessao.log, cc, aluno };
  const melhor = baixadas[escolha.indice] || baixadas[0];
  sessao.log.push(`Escolhida: ${escolha.indice} (${escolha.motivo})`);

  await sb.from('contatos_campanha').update({ meusalbuns_aluno: aluno.AlunoTurmaID_Cript }).eq('id', cc.id);
  return { ok: true, log: sessao.log, cc, aluno, foto: melhor, motivoEscolha: escolha.motivo };
}

async function enviarImagemUazapi(telefone: string, base64: string, legenda: string, viewOnce: boolean): Promise<{ ok: boolean; erro?: string }> {
  const url = Deno.env.get('UAZAPI_BASE_URL')?.trim();
  const token = Deno.env.get('UAZAPI_TOKEN')?.trim();
  if (!url || !token) return { ok: false, erro: 'uazapi_nao_configurada' };
  try {
    const res = await fetch(`${url}/send/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', token },
      body: JSON.stringify({
        number: telefone,
        type: 'image',
        file: `data:image/jpeg;base64,${base64}`,
        text: legenda,
        ...(viewOnce ? { viewOnce: true } : {}),
      }),
    });
    const corpo = await res.text();
    if (!res.ok) return { ok: false, erro: `uazapi_${res.status}: ${corpo.slice(0, 200)}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : 'erro_rede' };
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Metodo nao permitido' }, 405);

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  try {
    const body = await req.json().catch(() => ({}));
    const acao = body?.acao;

    // Teste de conexao: login + lista de alunos (nao envia nada)
    if (acao === 'testar') {
      const sessao = new Sessao();
      const logado = await sessao.login();
      let total = 0;
      if (logado) total = (await listarAlunos(sb, sessao, true)).length;
      return json({ success: logado && total > 0, logado, total_alunos: total, log: sessao.log });
    }

    // Previa: escolhe a foto e devolve, sem enviar
    if (acao === 'previa') {
      const r: any = await prepararFoto(sb, body.contato_campanha_id);
      return json({
        success: r.ok,
        motivo: r.motivo || null,
        aluno: r.aluno ? { nome: r.aluno.NomeAluno, turma: r.aluno.PIT, fotos: r.aluno.QtdFotos } : null,
        imagem: r.ok ? `data:image/jpeg;base64,${r.foto.base64}` : null,
        motivo_escolha: r.motivoEscolha || null,
        log: r.log,
      });
    }

    // Envio (chamado pela IA de vendas ou pelo botao do painel)
    if (acao === 'enviar') {
      const { data: cfg } = await sb.from('resgate_config').select('fotos_ativas, fotos_visualizacao_unica, fotos_frase').eq('id', 1).maybeSingle();
      const manual = body.origem === 'manual';
      if (!manual && !cfg?.fotos_ativas) return json({ success: false, motivo: 'fotos_desativadas' });

      const { data: ja } = await sb.from('contatos_campanha').select('foto_enviada_em').eq('id', body.contato_campanha_id).maybeSingle();
      if (ja?.foto_enviada_em && !body.forcar) return json({ success: false, motivo: 'foto_ja_enviada' });

      const r: any = await prepararFoto(sb, body.contato_campanha_id);
      if (!r.ok) {
        console.warn('[Fotos] Nao enviou:', r.motivo, r.log);
        return json({ success: false, motivo: r.motivo, log: r.log });
      }

      const legenda = String(cfg?.fotos_frase || '').replace(/\{nome\}/gi, primeiroNome(r.cc.nome)).trim();
      const envio = await enviarImagemUazapi(r.cc.telefone, r.foto.base64, legenda, cfg?.fotos_visualizacao_unica !== false);
      if (!envio.ok) return json({ success: false, motivo: 'envio_falhou', erro: envio.erro, log: r.log });

      const agora = new Date().toISOString();
      await sb.from('contatos_campanha').update({ foto_enviada_em: agora, foto_enviada_url: r.foto.url }).eq('id', r.cc.id);

      // Registra no chat do painel
      const { data: contato } = await sb.from('contacts').select('id').eq('phone', r.cc.telefone).maybeSingle();
      if (contato?.id) {
        await sb.from('messages').insert({
          contact_id: contato.id,
          direction: 'out',
          content: `[Foto do formando enviada${cfg?.fotos_visualizacao_unica !== false ? ' - visualização única' : ''}] ${legenda}`,
          sent_by: 'ia',
          seq: 0,
          message_type: 'image',
          media_url: r.foto.url,
        });
      }
      console.log(`[Fotos] Foto enviada para ${r.cc.nome}`);
      return json({ success: true, log: r.log });
    }

    return json({ error: 'Acao desconhecida' }, 400);
  } catch (e) {
    console.error('[Fotos] Erro:', e);
    return json({ error: e instanceof Error ? e.message : 'erro' }, 500);
  }
});
