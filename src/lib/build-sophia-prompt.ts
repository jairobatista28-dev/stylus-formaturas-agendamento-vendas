const T: Record<string, string> = {
  friendly: 'Seja amigavel. Use o nome do formando.',
  formal: 'Tom formal e profissional.',
  casual: 'Linguagem descontraida e informal.',
  direct: 'Direto ao ponto. Sem rodeios.',
};

export interface SophiaPromptConfig {
  course_target?: string;
  available_slots?: string;
  session_location?: string;
  session_duration?: string;
  scheduling_deadline?: string;
  conversation_tone?: string;
  objection_handling?: string;
  extra_info?: string;
  ai_prompt_extra?: string;
}

export function buildSophiaPrompt(f: SophiaPromptConfig): string {
  const p: string[] = [];

  if (f.course_target) p.push('TURMA: ' + f.course_target);
  if (f.available_slots) p.push('HORARIOS:\n' + f.available_slots);
  if (f.session_location) p.push('LOCAL:\n' + f.session_location);
  if (f.session_duration) p.push('DURACAO: ' + f.session_duration);
  if (f.scheduling_deadline) p.push('PRAZO: ' + f.scheduling_deadline);
  if (f.conversation_tone && T[f.conversation_tone]) p.push('TOM: ' + T[f.conversation_tone]);
  if (f.objection_handling) p.push('OBJECCOES:\n' + f.objection_handling);
  if (f.extra_info) p.push('INFORMACOES:\n' + f.extra_info);
  if (f.ai_prompt_extra) p.push('EXTRAS:\n' + f.ai_prompt_extra);

  return p.join('\n\n');
}
