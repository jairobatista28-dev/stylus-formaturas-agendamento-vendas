/**
 * Parser para mensagens de campanha com marcadores de delay
 * Formato: [esperar Xs] ou [delay X] para indicar pausa entre blocos
 */

export interface MessageBlock {
  ordem: number;
  texto: string;
  delayBloco: number; // delay em segundos antes deste bloco
}

/**
 * Parseia a mensagem completa e divide em blocos baseado nos marcadores de delay
 * Marcadores suportados: [esperar Xs], [delay X], [aguardar Xs]
 * Exemplo: "Olá {nome}! [esperar 8s] Como vai?"
 */
export function parseMensagemCampanha(
  textoCompleto: string,
  nomeFormando: string
): MessageBlock[] {
  // Substitui placeholders pelo nome do formando
  // Importante: substituir {{nome}} (duplo) ANTES de {nome} (simples)
  let textoTratado = textoCompleto
    .replace(/\{\{nome_formando\}\}/gi, nomeFormando)
    .replace(/\{\{nome\}\}/gi, nomeFormando)
    .replace(/{nome}/gi, nomeFormando)
    .replace(/\(aqui a ia precisa consultar o nome do formando\)/gi, nomeFormando);

  // Regex para encontrar marcadores de delay
  const delayPattern = /\[(?:esperar|delay|aguardar)\s*(\d+)\s*s?\s*\]/gi;

  // Divide o texto em partes usando os marcadores
  const parts: Array<{ text: string; delay: number }> = [];
  let lastIndex = 0;
  let match;

  while ((match = delayPattern.exec(textoTratado)) !== null) {
    // Adiciona o texto antes do marcador
    if (match.index > lastIndex) {
      const textBefore = textoTratado.substring(lastIndex, match.index).trim();
      if (textBefore) {
        parts.push({ text: textBefore, delay: 0 });
      }
    }
    lastIndex = match.index + match[0].length;

    // O delay especificado no marcador
    const delaySeconds = parseInt(match[1], 10) || 0;

    // Encontra o próximo bloco de texto
    const nextMatch = delayPattern.exec(textoTratado);
    const endIndex = nextMatch ? nextMatch.index : textoTratado.length;
    delayPattern.lastIndex = lastIndex; // Reset regex index

    const textAfter = textoTratado.substring(lastIndex, endIndex).trim();
    if (textAfter) {
      parts.push({ text: textAfter, delay: delaySeconds });
    }
    lastIndex = endIndex;
  }

  // Adiciona o restante do texto se não houver mais marcadores
  if (lastIndex < textoTratado.length) {
    const remainingText = textoTratado.substring(lastIndex).trim();
    if (remainingText) {
      parts.push({ text: remainingText, delay: 0 });
    }
  }

  // Se não encontrou marcadores, retorna o texto completo como um único bloco
  if (parts.length === 0 && textoTratado.trim()) {
    parts.push({ text: textoTratado.trim(), delay: 0 });
  }

  // Converte para blocos numerados
  const blocos: MessageBlock[] = parts.map((part, index) => ({
    ordem: index + 1,
    texto: part.text,
    delayBloco: index === 0 ? 0 : part.delay, // Primeiro bloco não tem delay
  }));

  return blocos;
}

/**
 * Cria registros na fila de envios para cada bloco da mensagem
 */
export async function criarFilaEnvios(
  supabase: any,
  contatoId: string,
  campanhaId: string,
  telefone: string,
  blocos: MessageBlock[]
): Promise<{ success: boolean; error?: string }> {
  try {
    const registros = blocos.map((bloco) => ({
      contato_id: contatoId,
      campanha_id: campanhaId,
      telefone,
      mensagem: bloco.texto,
      ordem_bloco: bloco.ordem,
      delay_bloco: bloco.delayBloco,
      simular_digitacao: Math.floor(Math.random() * 3) + 2, // 2-4 segundos
      status: 'pendente',
    }));

    const { error } = await supabase
      .from('fila_envios')
      .insert(registros);

    if (error) throw error;

    return { success: true };
  } catch (err) {
    console.error('Erro ao criar fila de envios:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Erro desconhecido',
    };
  }
}

/**
 * Gera delay randômico anti-bloqueio (40-90 segundos)
 * Usado apenas entre contatos diferentes (primeiro bloco)
 */
export function gerarDelayAntiBloqueio(): number {
  const minDelay = 40;
  const maxDelay = 90;
  return Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
}

/**
 * Gera delay de digitação simulada (2-4 segundos)
 */
export function gerarDelayDigitacao(): number {
  return Math.floor(Math.random() * 3000) + 2000;
}

/**
 * Exemplo de mensagem estruturada para Stylus Formaturas
 */
export const MENSAGEM_MODELO_STYLUS = `Olá {nome}, tudo bem com vc?

Aqui é a Sophia, do setor Fotográfico da Stylus Formaturas. 😊

[esperar 8s]

Lembra daquele momento em que você ergueu o diploma e viu o orgulho nos olhos de quem ama?
E saiu de lá Formado 🎓

Agora já está tudo pronto para eternizar a emoção desse dia inesquecível. 🥳👏🏻🍾

[esperar 6s]

Temos uma notícia incrível pra te contar:

📸 Seu material fotográfico foi liberado ANTES do prazo previsto em contrato e, suas fotos estão prontas e disponíveis para aquisição por isso, estamos abrindo uma condição MUITO especial de pré-venda para os alunos e por tempo limitado.

[esperar 4s]

> 🔓 SEMANA DO ACESSO TOTAL
⏳ Somente de (data inicio) até (data fim)

Durante esse período, você poderá conhecer as opções especiais preparadas para sua turma. Queremos garantir que você tenha essas memórias eternizadas! ✨

Você poderá escolher:
📂 Arquivo digital completo com todas as suas fotos
📖 Álbum impresso (físico) + arquivo digital + acessórios especiais
✨ Várias opções exclusivas preparadas para essa pré-venda 🎁

[esperar 4s]

E tem mais! 💛

Quem garantir a aquisição do material durante a pré-venda receberá um brinde especial:
- 🎁 10 fotos estilo Polaroid

⚠️ IMPORTANTE:
Essa condição promocional possui prazo limitadíssimo, pois foi liberada antecipadamente antes do encerramento contratual da turma.

Agora escolha uma das datas disponíveis para agendarmos sua visita e apresentarmos seu material fotográfico: 😊📸`;
