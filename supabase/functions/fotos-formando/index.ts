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
 * Acoes: testar | previa | enviar | enviar_kit (3 fotos: beca / familia, campanha Ultima Oportunidade)
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
const TAMANHO_MINIMO_FOTO = 8000;   // bytes - abaixo disso e imagem de erro/placeholder, nao foto real
const NUMERO_ALERTA = '5592993809136'; // recebe aviso quando a foto nao pode ser enviada
const ALERTA_INTERVALO_HORAS = 3;     // no maximo 1 aviso por motivo a cada 3h
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

/** Procura o token da conta (usado no cabecalho Authtoken) em HTML/JSON/cookie */
function extrairToken(texto: string): string | null {
  const t = String(texto || '');
  const padroes = [
    /var\s+token\s*=\s*["']([A-Za-z0-9+/=_-]{20,})["']/i,
    /["']?Token["']?\s*[:=]\s*["']([A-Za-z0-9+/=_-]{20,})["']/i,
    /authtoken["']?\s*[:=,]\s*["']([A-Za-z0-9+/=_-]{20,})["']/i,
    /%22Token%22%3A%22([A-Za-z0-9%+/=_-]{20,}?)%22/i,
  ];
  for (const re of padroes) {
    const m = t.match(re);
    if (m) return decodeURIComponent(m[1]);
  }
  return null;
}

class Sessao {
  cookies = new Map<string, string>();
  log: string[] = [];
  authToken: string | null = null;
  ultimaUrl = '';
  rastrearRedirecionamentos = false;

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
      if (this.authToken) {
        headers.set('Authtoken', this.authToken);
        headers.set('Authtype', 'Token');
      }
      const res = await fetch(atual, { ...opcoes, headers, redirect: 'manual' });
      this.guardarCookies(res);
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        const destino = new URL(res.headers.get('location')!, atual).toString();
        if (this.rastrearRedirecionamentos) {
          this.log.push(`  ${res.status}: ${new URL(atual).pathname}${new URL(atual).search} -> ${new URL(destino).pathname}${new URL(destino).search}`);
        }
        atual = destino;
        opcoes = { method: 'GET' };
        continue;
      }
      this.ultimaUrl = atual;
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
    if (!r3.ok) return false;

    // IMPORTANTE: o cookie "user_offline" precisa entrar LOGO apos o login, antes de
    // qualquer visita a paginas do site. Sem ele, a primeira pagina visitada encerra a
    // sessao e tudo passa a redirecionar para o Login.
    let origem = '';
    const userOffline = Deno.env.get('MEUSALBUNS_USER_OFFLINE')?.trim();
    if (userOffline) {
      this.cookies.set('user_offline', userOffline);
      if (!this.cookies.has('TokenF')) this.cookies.set('TokenF', '');
      this.cookies.set('UrlOriginalString', encodeURIComponent(`${BASE}/Login/`));
      try {
        const dados = JSON.parse(userOffline);
        if (dados?.Token) { this.authToken = String(dados.Token); origem = 'secret MEUSALBUNS_USER_OFFLINE'; }
        this.log.push(`Cookie user_offline: configurado logo apos o login (conta ${dados?.Nickname || dados?.Name || '?'})`);
      } catch {
        this.log.push('Cookie user_offline: configurado, mas o valor nao e um JSON valido (confira o secret)');
      }
    } else {
      this.log.push('Cookie user_offline: NAO configurado (crie o secret MEUSALBUNS_USER_OFFLINE)');
    }

    // Token da API: do cookie acima, da resposta do login ou do secret MEUSALBUNS_TOKEN
    if (!this.authToken) {
      const tk = extrairToken(corpo);
      if (tk) { this.authToken = tk; origem = 'resposta do login'; }
    }
    if (!this.authToken) {
      const secreto = Deno.env.get('MEUSALBUNS_TOKEN')?.trim();
      if (secreto) { this.authToken = secreto; origem = 'secret MEUSALBUNS_TOKEN'; }
    }
    this.log.push(this.authToken
      ? `Token da API: encontrado (${origem})`
      : 'Token da API: NAO encontrado (crie o secret MEUSALBUNS_TOKEN)');
    return true;
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
  sessao.rastrearRedirecionamentos = true;
  const res = await sessao.req(`/Produtos?a=${encodeURIComponent(aluno.AlunoTurmaID_Cript)}&fotos=true`);
  sessao.rastrearRedirecionamentos = false;
  const html = await res.text();
  const titulo = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() || '(sem titulo)';
  let final = sessao.ultimaUrl;
  try { const u = new URL(final); final = u.pathname + u.search; } catch { /* mantem */ }
  sessao.log.push(`Pagina de fotos -> ${res.status} (${Math.round(html.length / 1024)} kB) | pagina final: ${final} | titulo: ${titulo} | tem oPhotos: ${html.includes('oPhotos') ? 'sim' : 'nao'}`);
  if (!html.includes('oPhotos')) {
    const texto = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
    sessao.log.push(`Conteudo recebido: ${mascarar(texto).slice(0, 250)}`);
  }

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
    if (bytes.length < TAMANHO_MINIMO_FOTO) return null; // placeholder de token vencido
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
// KIT DE FOTOS (campanha "Ultima Oportunidade"): 3 fotos, de preferencia
// o formando de beca e com a familia, em visualizacao unica
// ============================================================================

const MAX_CANDIDATAS_KIT = 12;

/** Ate 12 candidatas espalhadas pelo album, misturando verticais (beca/individual) e horizontais (familia/grupo) */
function selecionarCandidatasKit(fotos: FotoMA[]): FotoMA[] {
  const validas = fotos.filter((f) => f.RenderMain && !f.FlBrinde);
  if (validas.length <= MAX_CANDIDATAS_KIT) return validas;
  const espalhar = (lista: FotoMA[], n: number) => {
    if (lista.length <= n) return lista;
    const passo = lista.length / n;
    return Array.from({ length: n }, (_, i) => lista[Math.floor(i * passo + passo / 2)]);
  };
  const verticais = validas.filter((f) => (f.Height || 0) > (f.Width || 0));
  const horizontais = validas.filter((f) => (f.Height || 0) <= (f.Width || 0));
  const nHoriz = Math.min(horizontais.length, 5);
  const nVert = Math.min(verticais.length, MAX_CANDIDATAS_KIT - nHoriz);
  const escolhidas = [...espalhar(verticais, nVert), ...espalhar(horizontais, nHoriz)];
  if (escolhidas.length < MAX_CANDIDATAS_KIT) {
    for (const f of espalhar(validas, MAX_CANDIDATAS_KIT)) {
      if (escolhidas.length >= MAX_CANDIDATAS_KIT) break;
      if (!escolhidas.includes(f)) escolhidas.push(f);
    }
  }
  return escolhidas;
}

/** Gemini escolhe as N melhores, priorizando: formando de beca (individual) e com a familia */
async function escolherKit(imagens: string[], nome: string, quantidade: number): Promise<{ indices: number[]; motivo: string }> {
  const padrao = imagens.map((_, i) => i).slice(0, quantidade);
  const chave = Deno.env.get('GEMINI_API_KEY');
  if (!chave || imagens.length <= quantidade) return { indices: padrao, motivo: 'padrao' };
  const parts: any[] = imagens.map((b64) => ({ inline_data: { mime_type: 'image/jpeg', data: b64 } }));
  parts.push({
    text:
      `Estas sao ${imagens.length} fotos (indices 0 a ${imagens.length - 1}, na ordem) da formatura de ${nome}. ` +
      `Escolha as ${quantidade} MELHORES (indices diferentes) para enviar a essa pessoa como previa, para ela sentir vontade de ter as fotos. ` +
      `Prioridade: 1) o/a formando/a DE BECA em destaque, rosto bem visivel e bonito (olhos abertos, de preferencia sorrindo); ` +
      `2) o/a formando/a COM A FAMILIA (pais, avos, filhos, parceiro), todos de frente e bem enquadrados; ` +
      `3) outra foto marcante do/a formando/a (com diploma, capelo, momento da cerimonia). ` +
      `Se possivel, inclua pelo menos uma de beca e uma com a familia. Evite fotos borradas, de costas, olhos fechados, ` +
      `fotos repetidas/muito parecidas entre si e fotos em que a pessoa aparece pequena. ` +
      `Responda SOMENTE JSON: {"fotos": [{"indice": numero, "tipo": "beca" | "familia" | "outra"}], "motivo": "frase curta"}, ` +
      `na ordem em que devem ser enviadas (beca primeiro, familia depois).`,
  });
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${chave}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseMimeType: 'application/json', temperature: 0 } }),
      }
    );
    if (!res.ok) return { indices: padrao, motivo: `gemini_${res.status}` };
    const j = await res.json();
    const out = JSON.parse((j?.candidates?.[0]?.content?.parts?.[0]?.text || '{}').replace(/```json|```/g, '').trim());
    const indices: number[] = [];
    for (const f of Array.isArray(out?.fotos) ? out.fotos : []) {
      const idx = Number(f?.indice);
      if (Number.isInteger(idx) && idx >= 0 && idx < imagens.length && !indices.includes(idx)) indices.push(idx);
      if (indices.length >= quantidade) break;
    }
    // Completa se o Gemini devolveu menos do que o pedido
    for (let i = 0; indices.length < quantidade && i < imagens.length; i++) if (!indices.includes(i)) indices.push(i);
    return { indices, motivo: String(out?.motivo || '') };
  } catch (e) {
    console.warn('[Fotos] Gemini (kit) falhou:', e);
  }
  return { indices: padrao, motivo: 'fallback' };
}

// ============================================================================
// FLUXO PRINCIPAL
// ============================================================================

function primeiroNome(nome?: string | null): string {
  const p = String(nome || '').trim().split(/\s+/)[0] || '';
  return p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : '';
}

/** Token da conta (para validar o codigo de sincronizacao que roda no navegador) */
function tokenDaConta(): string | null {
  const uo = Deno.env.get('MEUSALBUNS_USER_OFFLINE')?.trim();
  if (uo) {
    try {
      const t = JSON.parse(uo)?.Token;
      if (t) return String(t);
    } catch { /* ignora */ }
  }
  return Deno.env.get('MEUSALBUNS_TOKEN')?.trim() || null;
}

/**
 * Prepara a foto usando as fotos SINCRONIZADAS pelo navegador (tabela
 * meusalbuns_fotos). Nao depende do login no site: os enderecos das fotos
 * (hash + token) abrem sem login.
 */
async function prepararFoto(sb: any, contatoCampanhaId: string, excluirHashes: string[] = [], quantidadeKit = 0) {
  const log: string[] = [];
  const { data: cc } = await sb
    .from('contatos_campanha')
    .select('id, nome, telefone, numero_contrato, status, foto_enviada_em, foto_enviada_url, meusalbuns_aluno')
    .eq('id', contatoCampanhaId)
    .maybeSingle();
  if (!cc) return { ok: false, motivo: 'contato_nao_encontrado', log };

  const pit = String(cc.numero_contrato || '').replace(/\D/g, '');
  const consulta = sb.from('meusalbuns_fotos').select('aluno_cript, nome_aluno, pit, qtd_fotos, token_foto, fotos, atualizado_em');
  const { data: linhas } = pit ? await consulta.eq('pit', pit) : await consulta.limit(5000);
  log.push(`Alunos sincronizados ${pit ? `na turma ${pit}` : '(todas as turmas)'}: ${linhas?.length || 0}`);
  if (!linhas || !linhas.length) return { ok: false, motivo: 'turma_nao_sincronizada', log, cc };

  // Se ja sabemos qual e o aluno (envio anterior), usa direto
  let linha: any = cc.meusalbuns_aluno ? linhas.find((l: any) => l.aluno_cript === cc.meusalbuns_aluno) : null;
  if (!linha) {
    const alunos: AlunoMA[] = linhas.map((l: any) => ({
      NomeAluno: l.nome_aluno,
      PIT: l.pit,
      QtdFotos: l.qtd_fotos,
      AlunoTurmaID: 0,
      AlunoTurmaID_Cript: l.aluno_cript,
    }));
    const achado = encontrarAluno(alunos, cc.nome, cc.numero_contrato);
    if (!achado.aluno) return { ok: false, motivo: achado.motivo, log, cc };
    linha = linhas.find((l: any) => l.aluno_cript === achado.aluno!.AlunoTurmaID_Cript);
  }
  const aluno: AlunoMA = {
    NomeAluno: linha.nome_aluno,
    PIT: linha.pit,
    QtdFotos: linha.qtd_fotos,
    AlunoTurmaID: 0,
    AlunoTurmaID_Cript: linha.aluno_cript,
  };
  log.push(`Aluno: ${aluno.NomeAluno} (turma ${aluno.PIT}, ${aluno.QtdFotos} fotos, sincronizado em ${new Date(linha.atualizado_em).toLocaleDateString('pt-BR')})`);

  const todas: FotoMA[] = (linha.fotos || []).map((f: any) => ({ RenderMain: f.h, Width: f.w, Height: f.a, FlBrinde: false }));
  if (!todas.length) return { ok: false, motivo: 'fotos_indisponiveis', log, cc, aluno };

  // Evita repetir a mesma foto ja enviada (resgate / novo pedido de previa)
  const ineditas = todas.filter((f) => !excluirHashes.some((h) => h && String(h).includes(f.RenderMain)));
  const fotos = ineditas.length ? ineditas : todas;
  const candidatas = quantidadeKit > 0 ? selecionarCandidatasKit(fotos) : selecionarCandidatas(fotos);

  // Tokens a tentar: o do aluno e, se ele vencer, os das sincronizacoes mais recentes
  const tokens: string[] = [linha.token_foto];
  const { data: recentes } = await sb
    .from('meusalbuns_fotos')
    .select('token_foto')
    .order('atualizado_em', { ascending: false })
    .limit(20);
  for (const r of recentes || []) if (r.token_foto && !tokens.includes(r.token_foto)) tokens.push(r.token_foto);

  let baixadas: Array<{ foto: FotoMA; base64: string; url: string }> = [];
  for (const tk of tokens.slice(0, 4)) {
    baixadas = [];
    for (const f of candidatas) {
      const img = await baixarImagem(urlDaFoto(`${BASE}/ImageFormatura`, f, tk));
      if (img) baixadas.push({ foto: f, base64: img.base64, url: img.finalUrl });
    }
    // Todas com o mesmo tamanho = imagem padrao de erro, nao fotos reais
    const tamanhos = new Set(baixadas.map((b) => b.base64.length));
    if (baixadas.length > 1 && tamanhos.size === 1) baixadas = [];
    if (baixadas.length) {
      if (tk !== linha.token_foto) {
        log.push('Token do aluno vencido - usado token de uma sincronizacao mais recente');
        await sb.from('meusalbuns_fotos').update({ token_foto: tk }).eq('aluno_cript', linha.aluno_cript);
      }
      break;
    }
  }
  log.push(`Candidatas baixadas: ${baixadas.length}/${candidatas.length}`);
  if (!baixadas.length) return { ok: false, motivo: 'token_vencido', log, cc, aluno };

  if (quantidadeKit > 0) {
    const kit = await escolherKit(baixadas.map((b) => b.base64), aluno.NomeAluno, quantidadeKit);
    const fotosKit = kit.indices.map((i) => baixadas[i]).filter(Boolean);
    log.push(`Kit escolhido: ${kit.indices.join(', ')} (${kit.motivo})`);
    await sb.from('contatos_campanha').update({ meusalbuns_aluno: aluno.AlunoTurmaID_Cript }).eq('id', cc.id);
    return { ok: true, log, cc, aluno, foto: fotosKit[0], fotosKit, motivoEscolha: kit.motivo };
  }

  const escolha = await escolherMelhor(baixadas.map((b) => b.base64), aluno.NomeAluno);
  // Se o Gemini achar que nenhuma serve, ainda assim manda a primeira candidata
  // (sao fotos individuais do proprio formando, ja com marca d'agua)
  const melhor = (escolha.indice >= 0 && baixadas[escolha.indice]) || baixadas[0];
  log.push(`Escolhida: ${escolha.indice} (${escolha.motivo})`);

  await sb.from('contatos_campanha').update({ meusalbuns_aluno: aluno.AlunoTurmaID_Cript }).eq('id', cc.id);
  return { ok: true, log, cc, aluno, foto: melhor, motivoEscolha: escolha.motivo };
}

const MOTIVOS_LEGIVEIS: Record<string, string> = {
  turma_nao_sincronizada: 'a turma desse contrato ainda nao foi sincronizada. Abra Vendas Pendentes > Foto do formando, copie o codigo e rode no Meus Albuns (F12 > Console).',
  token_vencido: 'o acesso as fotos venceu. Rode de novo o codigo de sincronizacao no Meus Albuns (Vendas Pendentes > Foto do formando).',
  fotos_indisponiveis: 'nao ha fotos sincronizadas para esse aluno. Rode a sincronizacao de novo.',
  nome_nao_encontrado_na_turma: 'o nome da planilha nao bate com o nome no Meus Albuns.',
  nome_ambiguo: 'existem dois alunos com nome parecido na turma; envie a foto manualmente.',
  turma_nao_encontrada: 'o contrato da planilha nao foi encontrado no Meus Albuns.',
  envio_falhou: 'a Uazapi recusou o envio da imagem.',
};

/** Avisa o Square no WhatsApp quando a foto nao pode ser enviada (com limite de frequencia) */
async function alertarFalhaFoto(sb: any, nome: string, contrato: string | null, motivo: string, detalhe?: string, telefone?: string | null) {
  // Painel de Alertas: registra TODA falha (o WhatsApp abaixo tem limite de frequencia)
  try {
    await sb.from('alertas_sistema').insert({
      tipo: 'foto_falhou',
      gravidade: 'erro',
      titulo: 'Foto do formando nao enviada',
      detalhe: `${MOTIVOS_LEGIVEIS[motivo] || motivo}${detalhe ? ' | ' + detalhe : ''}${contrato ? ' | contrato ' + contrato : ''}`.slice(0, 2000),
      contato_nome: nome,
      telefone: telefone || null,
    });
  } catch (e) {
    console.warn('[Fotos] Alerta nao registrado no painel:', e);
  }
  try {
    const chave = `alerta_foto_${motivo}`;
    const { data: ultimo } = await sb.from('meusalbuns_cache').select('atualizado_em').eq('chave', chave).maybeSingle();
    if (ultimo && Date.now() - new Date(ultimo.atualizado_em).getTime() < ALERTA_INTERVALO_HORAS * 3600000) return;
    await sb.from('meusalbuns_cache').upsert({ chave, valor: { nome, motivo }, atualizado_em: new Date().toISOString() });

    const url = Deno.env.get('UAZAPI_BASE_URL')?.trim();
    const token = Deno.env.get('UAZAPI_TOKEN')?.trim();
    if (!url || !token) return;
    const texto =
      `⚠️ *Foto do formando NAO enviada*\n\n` +
      `👤 ${nome}${contrato ? ` (contrato ${contrato})` : ''}\n` +
      `❌ Motivo: ${MOTIVOS_LEGIVEIS[motivo] || motivo}${detalhe ? `\n${detalhe}` : ''}\n\n` +
      `👉 Se quiser, envie a foto manualmente pelo painel.`;
    await fetch(`${url}/send/text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', token },
      body: JSON.stringify({ number: NUMERO_ALERTA, text: texto }),
    });
  } catch (e) {
    console.warn('[Fotos] Falha ao enviar alerta:', e);
  }
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
        ...(legenda ? { text: legenda } : {}),
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

    // ---------- Sincronizacao feita pelo navegador logado no Meus Albuns ----------
    if (acao === 'pits_necessarios' || acao === 'sincronizar') {
      const esperado = tokenDaConta();
      if (!esperado || body.token_conta !== esperado) {
        return json({ success: false, motivo: 'token_invalido' }, 403);
      }
    }

    if (acao === 'pits_necessarios') {
      // Turmas (contratos) das campanhas de venda com formandos que ainda nao compraram
      const { data: ccs } = await sb
        .from('contatos_campanha')
        .select('numero_contrato, status, campanhas!inner(tipo_atendimento)')
        .eq('campanhas.tipo_atendimento', 'venda_material')
        .not('status', 'in', '("comprou","sem_interesse")');
      const pits = [...new Set((ccs || []).map((c: any) => String(c.numero_contrato || '').replace(/\D/g, '')).filter(Boolean))];
      // Tokens das fotos vencem: re-sincroniza quem foi atualizado ha mais de 1 dia
      const limite = new Date(Date.now() - (body.forcar ? 0 : 1) * 86400000).toISOString();
      const { data: recentes } = await sb.from('meusalbuns_fotos').select('aluno_cript').gte('atualizado_em', limite);
      return json({ success: true, pits, sincronizados: (recentes || []).map((r: any) => r.aluno_cript) });
    }

    if (acao === 'sincronizar') {
      const lista = Array.isArray(body.alunos) ? body.alunos.slice(0, 50) : [];
      const linhas = lista
        .filter((a: any) => a?.cript && a?.token && Array.isArray(a?.fotos))
        .map((a: any) => ({
          aluno_cript: String(a.cript),
          nome_aluno: String(a.nome || ''),
          pit: String(a.pit || ''),
          qtd_fotos: Number(a.qtd) || null,
          token_foto: String(a.token),
          fotos: a.fotos.slice(0, 30).map((f: any) => ({ h: String(f.h), w: Number(f.w) || 0, a: Number(f.a) || 0 })),
          atualizado_em: new Date().toISOString(),
        }));
      if (linhas.length) {
        const { error } = await sb.from('meusalbuns_fotos').upsert(linhas, { onConflict: 'aluno_cript' });
        if (error) return json({ success: false, motivo: error.message }, 500);
      }
      return json({ success: true, gravados: linhas.length });
    }

    if (acao === 'status_sync') {
      const { count } = await sb.from('meusalbuns_fotos').select('aluno_cript', { count: 'exact', head: true });
      const { data: ultima } = await sb.from('meusalbuns_fotos').select('atualizado_em').order('atualizado_em', { ascending: false }).limit(1).maybeSingle();
      return json({ success: true, total: count || 0, ultima: ultima?.atualizado_em || null });
    }

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

    // Envio (chamado pela IA de vendas, pelo resgate/prorrogacao ou pelo botao do painel)
    //  origem: 'ia' | 'resgate' | 'manual'
    //  forcar: envia mesmo que ja tenha mandado foto antes (escolhe outra foto)
    //  legenda: substitui a frase padrao (ex: mensagem de prorrogacao)
    if (acao === 'enviar') {
      const { data: cfg } = await sb.from('resgate_config').select('fotos_ativas, fotos_visualizacao_unica, fotos_frase').eq('id', 1).maybeSingle();
      const manual = body.origem === 'manual';
      if (!manual && !cfg?.fotos_ativas) return json({ success: false, motivo: 'fotos_desativadas' });

      const { data: ja } = await sb.from('contatos_campanha').select('foto_enviada_em, foto_enviada_url').eq('id', body.contato_campanha_id).maybeSingle();
      if (ja?.foto_enviada_em && !body.forcar) return json({ success: false, motivo: 'foto_ja_enviada' });

      const r: any = await prepararFoto(sb, body.contato_campanha_id, ja?.foto_enviada_url ? [ja.foto_enviada_url] : []);
      if (!r.ok) {
        console.warn('[Fotos] Nao enviou:', r.motivo, r.log);
        if (!manual && r.cc) await alertarFalhaFoto(sb, r.cc.nome, r.cc.numero_contrato, r.motivo, undefined, r.cc.telefone);
        return json({ success: false, motivo: r.motivo, log: r.log });
      }

      const legendaBase = String(body.legenda || cfg?.fotos_frase || '');
      const legenda = legendaBase.replace(/\{nome\}/gi, primeiroNome(r.cc.nome)).trim();
      const viewOnce = cfg?.fotos_visualizacao_unica !== false;
      let envio = await enviarImagemUazapi(r.cc.telefone, r.foto.base64, legenda, viewOnce);
      // Algumas versoes da Uazapi recusam viewOnce: tenta de novo como imagem normal
      if (!envio.ok && viewOnce) envio = await enviarImagemUazapi(r.cc.telefone, r.foto.base64, legenda, false);
      if (!envio.ok) {
        if (!manual) await alertarFalhaFoto(sb, r.cc.nome, r.cc.numero_contrato, 'envio_falhou', envio.erro, r.cc.telefone);
        return json({ success: false, motivo: 'envio_falhou', erro: envio.erro, log: r.log });
      }

      const agora = new Date().toISOString();
      await sb.from('contatos_campanha').update({ foto_enviada_em: agora, foto_enviada_url: r.foto.url }).eq('id', r.cc.id);

      // Registra no chat do painel
      const { data: contato } = await sb.from('contacts').select('id').eq('phone', r.cc.telefone).maybeSingle();
      if (contato?.id) {
        await sb.from('messages').insert({
          contact_id: contato.id,
          direction: 'out',
          content: `[Foto do formando enviada${viewOnce ? ' - visualização única' : ''}] ${legenda}`,
          sent_by: 'ia',
          seq: 0,
          message_type: 'image',
          media_url: r.foto.url,
        });
      }
      console.log(`[Fotos] Foto enviada para ${r.cc.nome} (origem ${body.origem || 'ia'})`);
      return json({ success: true, log: r.log });
    }

    // Kit de fotos (campanha Ultima Oportunidade): texto curto + N fotos (padrao 3),
    // de preferencia de beca e com a familia, em visualizacao unica. Uma vez por formando.
    //  legenda: texto enviado ANTES das fotos ({nome} = primeiro nome)
    if (acao === 'enviar_kit') {
      const { data: cfg } = await sb.from('resgate_config').select('fotos_ativas, fotos_visualizacao_unica').eq('id', 1).maybeSingle();
      const manual = body.origem === 'manual';
      if (!manual && !cfg?.fotos_ativas) return json({ success: false, motivo: 'fotos_desativadas' });

      const quantidade = Math.min(Math.max(Number(body.quantidade) || 3, 1), 5);
      // Trava: so um envio do kit por formando, mesmo se ele mandar varias mensagens seguidas
      // (fotos_kit_enviadas: 0 = nunca enviado, -1 = enviando agora, -2 = falhou, >0 = quantidade enviada)
      const idCC = body.contato_campanha_id;
      const { data: trava } = await sb
        .from('contatos_campanha')
        .update({ fotos_kit_enviadas: -1 })
        .eq('id', idCC)
        .eq('fotos_kit_enviadas', 0)
        .select('id')
        .maybeSingle();
      if (!trava && !body.forcar) return json({ success: false, motivo: 'foto_ja_enviada' });
      // Falhou (ex: turma nao sincronizada): marca -2 para nao tentar de novo a cada mensagem
      const liberarTrava = async () => {
        await sb.from('contatos_campanha').update({ fotos_kit_enviadas: -2 }).eq('id', idCC).eq('fotos_kit_enviadas', -1);
      };

      const r: any = await prepararFoto(sb, idCC, [], quantidade);
      if (!r.ok || !r.fotosKit?.length) {
        await liberarTrava();
        console.warn('[Fotos] Kit nao enviado:', r.motivo, r.log);
        if (!manual && r.cc) await alertarFalhaFoto(sb, r.cc.nome, r.cc.numero_contrato, r.motivo || 'fotos_indisponiveis', undefined, r.cc.telefone);
        return json({ success: false, motivo: r.motivo || 'fotos_indisponiveis', log: r.log });
      }

      const url = Deno.env.get('UAZAPI_BASE_URL')?.trim();
      const token = Deno.env.get('UAZAPI_TOKEN')?.trim();
      const viewOnce = cfg?.fotos_visualizacao_unica !== false;
      const pn = primeiroNome(r.cc.nome);
      const total = r.fotosKit.length;
      const legendaPadrao = `Separei ${total === 1 ? 'uma foto sua' : `${total} fotos suas`} da formatura pra você ver como ficou${total === 1 ? '' : 'ram'}${pn ? ', {nome}' : ''} 📸${viewOnce ? ` ${total === 1 ? 'Ela abre' : 'Elas abrem'} uma única vez, então olha com calma 😊` : ''}`;
      const intro = String(body.legenda || legendaPadrao).replace(/\{nome\}/gi, pn).trim();

      const { data: contato } = await sb.from('contacts').select('id').eq('phone', r.cc.telefone).maybeSingle();

      // Texto curto antes das fotos (foto em visualizacao unica nao mostra legenda de forma confiavel)
      if (url && token && intro) {
        try {
          await fetch(`${url}/send/text`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', token },
            body: JSON.stringify({ number: r.cc.telefone, text: intro }),
          });
          if (contato?.id) {
            await sb.from('messages').insert({ contact_id: contato.id, direction: 'out', content: intro, sent_by: 'ia', seq: 0 });
          }
        } catch (e) {
          console.warn('[Fotos] Falha ao enviar texto do kit:', e);
        }
      }

      let enviadas = 0;
      const urls: string[] = [];
      for (const f of r.fotosKit) {
        await new Promise((res) => setTimeout(res, 1500 + Math.random() * 1500));
        let envio = await enviarImagemUazapi(r.cc.telefone, f.base64, '', viewOnce);
        if (!envio.ok && viewOnce) envio = await enviarImagemUazapi(r.cc.telefone, f.base64, '', false);
        if (!envio.ok) {
          console.warn('[Fotos] Falha no envio de uma foto do kit:', envio.erro);
          continue;
        }
        enviadas++;
        urls.push(f.url);
        if (contato?.id) {
          await sb.from('messages').insert({
            contact_id: contato.id,
            direction: 'out',
            content: `[Foto do formando enviada${viewOnce ? ' - visualização única' : ''}] (${enviadas}/${total})`,
            sent_by: 'ia',
            seq: 0,
            message_type: 'image',
            media_url: f.url,
          });
        }
      }

      if (!enviadas) {
        await liberarTrava();
        if (!manual) await alertarFalhaFoto(sb, r.cc.nome, r.cc.numero_contrato, 'envio_falhou', undefined, r.cc.telefone);
        return json({ success: false, motivo: 'envio_falhou', log: r.log });
      }

      await sb.from('contatos_campanha').update({
        foto_enviada_em: new Date().toISOString(),
        foto_enviada_url: urls.join(' '),
        fotos_kit_enviadas: enviadas,
      }).eq('id', r.cc.id);
      console.log(`[Fotos] Kit com ${enviadas} foto(s) enviado para ${r.cc.nome} (origem ${body.origem || 'ia'})`);
      return json({ success: true, enviadas, log: r.log });
    }

    return json({ error: 'Acao desconhecida' }, 400);
  } catch (e) {
    console.error('[Fotos] Erro:', e);
    return json({ error: e instanceof Error ? e.message : 'erro' }, 500);
  }
});
