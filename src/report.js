// 기록부: 상대에 대한 서정적인 기록(내가 보고 싶을 때 글 1회로 받음) + 그쪽 사람들의 소문·평판. 부수 효과 없음.

export function buildReportMessages(c, { cardText = '', lore = '', ledger = '', timeline = '', recent = '', prev = null } = {}) {
  const system = [
    'You keep a lyrical record book about a correspondent from another world, for the person who exchanges letters with them ({{user}}).',
    'Write in Korean, gently and poetically, like notes jotted in a diary or an archivist\'s margin — concrete images, no clichés, no purple overload.',
    'Stay consistent with the character sheet, world lore and what happened in the letters. Never contradict facts; never decide {{user}}\'s feelings.',
    'voices = people of THEIR world talking about them (family, coworkers, neighbours, rivals, a shopkeeper…), each in their own voice and speech style; use names and relations from the lore when they exist, otherwise invent fitting minor people. Some voices may reveal things the character hides: mark those "hidden": true (1~2 of them).',
  ].join('\n');
  const user = [
    `<character name="${c.name}">\n${String(cardText || c.brief || '').slice(0, 3000)}\n</character>`,
    lore ? `<world>\n${lore.slice(0, 3500)}\n</world>` : '',
    ledger ? `<relationship_with_user>\n${ledger.slice(0, 1500)}\n</relationship_with_user>` : '',
    timeline ? `<their_life_so_far>\n${timeline.slice(0, 2000)}\n</their_life_so_far>` : '',
    recent ? `<latest_letters>\n${recent.slice(0, 2500)}\n</latest_letters>` : '',
    prev ? `<previous_record date="${prev.date || ''}">\n${prev.title || ''}\n${String(prev.note || '').slice(0, 1200)}\n</previous_record>\nThis is an update: let the record reflect what changed since then, and fill "changed".` : '',
    'Output JSON only:',
    '{"title":"short poetic title","note":"lyrical record, 3~5 short paragraphs (600~1100 Korean characters)","facts":[{"label":"","value":""}],"voices":[{"who":"","relation":"","says":"","hidden":false}],"changed":""}',
    'facts: 5~8 short dossier lines a reader could know from the letters (occupation, where they live, habits, what they keep…). voices: 4~6.',
  ].filter(Boolean).join('\n').replaceAll('{{char}}', c.name);
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

const rs = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
export function cleanReport(raw, now = Date.now()) {
  const note = rs(raw?.note, 4000);
  if (!note) throw new Error('기록부 글이 비어 있습니다.');
  return {
    at: now,
    title: rs(raw?.title, 120) || '기록',
    note,
    facts: (Array.isArray(raw?.facts) ? raw.facts : []).map((f) => ({ label: rs(f?.label, 40), value: rs(f?.value, 300) })).filter((f) => f.label && f.value).slice(0, 10),
    voices: (Array.isArray(raw?.voices) ? raw.voices : []).map((v) => ({ who: rs(v?.who, 60), relation: rs(v?.relation, 80), says: rs(v?.says, 600), hidden: !!v?.hidden })).filter((v) => v.who && v.says).slice(0, 8),
    changed: rs(raw?.changed, 600),
  };
}
