// 이야기: 사건 생성기(그쪽·이쪽) + 마무리하기(에필로그) + 그 후 더 듣기. 글 1회씩, 내가 누를 때만.
// 그쪽 사건 → 그쪽 연대기에 「진행 중」으로 끼워 넣어 다음 답장에 스며들게.
// 이쪽 사건(페르소나가 있을 때만) → 내 기록에만. 상대는 내가 편지에 쓴 만큼만 안다.

const ss = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function storyOf(c) {
  const s = c?.story || {};
  return { events: Array.isArray(s.events) ? s.events : [], epilogue: Array.isArray(s.epilogue) ? s.epilogue : [] };
}

const tagBlock = (tag, text, max) => (text ? `<${tag}>\n${String(text).slice(0, max)}\n</${tag}>` : '');

// side: 'them' = 그쪽 세계의 그 사람에게 / 'me' = 편지를 쓰는 나(페르소나)에게
export function buildEventMessages(c, { side = 'them', keywords = '', cardText = '', lore = '', ledger = '', timeline = '', recent = '', persona = null, myEvents = '', theirNow = '' } = {}) {
  const me = side === 'me';
  const pName = persona?.name || '{{user}}';
  const system = [
    me
      ? `You invent one event in the life of ${pName}, the person who writes letters to ${c.name} (who lives in another world). ${pName} lives in their own world, described by their persona sheet — not in ${c.name}'s world.`
      : `You invent one event in the life of ${c.name}, who lives in another world and exchanges letters with ${pName}.`,
    'The event must fit the context: the character, their world, their current situation and the letters so far. It should be concrete and have consequences that can unfold over the next letters (not resolved yet).',
    keywords ? `It must be built around these keywords or idea: ${keywords}` : 'Choose what fits best now — it may be small and everyday or large, joyful or troubling; avoid melodrama for its own sake.',
    me
      ? `Describe only what happens around ${pName} (circumstances, people, things). Do not decide ${pName}'s feelings, words or choices. ${c.name} knows nothing about it unless ${pName} writes it in a letter.`
      : `Never decide ${pName}'s actions or feelings. Stay consistent with established facts.`,
    'Write in Korean.',
  ].join('\n');
  const user = [
    me ? tagBlock('persona', persona?.card || '(설명 없음)', 2500) : tagBlock('character', cardText || c.brief, 3000),
    me ? tagBlock('correspondent', `${c.name}: ${String(c.brief || '').slice(0, 600)}`, 800) : tagBlock('world', lore, 3000),
    ledger ? tagBlock('relationship', ledger, 1200) : '',
    me ? (myEvents ? tagBlock('earlier_events_of_persona', myEvents, 1500) : '') : (timeline ? tagBlock('their_life_so_far', timeline, 1800) : ''),
    recent ? tagBlock('latest_letters', recent, 2500) : '',
    !me && theirNow ? `their_now=${theirNow}` : '',
    'Output JSON only: {"title":"short title","event":"what happens, 3~5 sentences, concrete, with at least one sensory detail"}',
  ].filter(Boolean).join('\n').replaceAll('{{char}}', c.name);
  return [{ role: 'system', content: system.replaceAll('{{user}}', pName) }, { role: 'user', content: user.replaceAll('{{user}}', pName) }];
}

export function cleanEvent(raw, { side = 'them', keywords = '', when = '', now = Date.now() } = {}) {
  const event = ss(raw?.event, 1500);
  if (!event) throw new Error('사건 글이 비어 있습니다.');
  return { id: `ev_${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, at: now, side: side === 'me' ? 'me' : 'them', title: ss(raw?.title, 80) || '사건', event, keywords: ss(keywords, 200), when: ss(when, 80) };
}

// 그쪽 사건을 연대기에 「진행 중」으로 넣는다(다음 답장의 <your_life>에 들어감)
export function addEvent(c, ev) {
  const st = storyOf(c);
  let out = { ...c, story: { ...st, events: [...st.events, ev].slice(-60) } };
  if (ev.side === 'them') {
    const mem = c.memory || { summaries: [], chapters: [], ledger: {}, timeline: [], changes: [], organizedUpTo: '' };
    out = { ...out, memory: { ...mem, timeline: [...(mem.timeline || []), { when: ev.when || '', event: `${ev.title} — ${ev.event}`, open: true, gen: ev.id }] } };
  }
  return out;
}

// 마무리(첫 번째) 또는 그 후(이어서). noPersona면 이쪽 삶은 쓰지 않는다.
export function buildEpilogueMessages(c, { cardText = '', lore = '', ledger = '', chapters = '', summaries = '', timeline = '', recent = '', report = '', persona = null, myEvents = '', myLetters = '', prev = [], ask = '', style = '' } = {}) {
  const noP = !!c.noPersona || !persona;
  const pName = noP ? '{{user}}' : persona.name || '{{user}}';
  const first = !prev.length;
  const system = [
    `You write the ending of a correspondence between ${c.name}, who lives in another world, and ${pName}, who only exchanged letters with them.`,
    first
      ? 'Write an epilogue: how things turned out after the letters — what became of their life, the things they kept, the promises and unanswered questions, and the bond between them.'
      : 'Continue the after-story: tell what happened later, after the previous epilogue entries, answering what the reader wants to know.',
    noP
      ? `${pName} is a real person writing as themselves from present-day Earth. Do NOT narrate ${pName}'s life, actions or feelings at all. Tell only ${c.name}'s side: their life afterwards, what the letters meant to them, what they did with them.`
      : `You may tell both sides: ${c.name}'s life afterwards and ${pName}'s life afterwards (based on the persona sheet and their own events), but keep ${pName}'s inner feelings light and plausible, never contradicting what they wrote.`,
    'Stay strictly consistent with everything established. Time may pass (months, years) — say how much. Prefer concrete scenes and objects over summary.',
    style ? `Write in Korean. ${style}` : 'Write in Korean, warm and literary, like the last chapter of a novel — no clichés.',
  ].join('\n');
  const user = [
    tagBlock('character', cardText || c.brief, 2500),
    tagBlock('world', lore, 2000),
    noP ? '' : tagBlock('persona', `${pName}\n${persona.card || ''}`, 1800),
    noP || !myEvents ? '' : tagBlock('persona_events', myEvents, 1500),
    tagBlock('relationship', ledger, 1200),
    tagBlock('story_so_far', [chapters, summaries].filter(Boolean).join('\n'), 3000),
    tagBlock('their_life', timeline, 2000),
    tagBlock('record_book', report, 1200),
    myLetters ? tagBlock('user_latest_letters', myLetters, 1500) : '',
    tagBlock('latest_letters_from_them', recent, 2000),
    prev.length ? tagBlock('epilogue_so_far', prev.map((e, i) => `[${i + 1}] ${e.ask ? `(asked: ${e.ask}) ` : ''}${e.title}\n${e.text}`).join('\n\n'), 5000) : '',
    !first ? (ask ? `The reader asks: ${ask}\nAnswer it with what happened afterwards.` : 'The reader wants to know what happened after that. Move forward in time.') : '',
    `Output JSON only: {"title":"short title","when":"how much later (e.g. 반년 뒤)","text":"${first ? '4~7 paragraphs (1200~2200 Korean characters)' : '3~5 paragraphs (800~1600 Korean characters)'}"}`,
  ].filter(Boolean).join('\n').replaceAll('{{char}}', c.name);
  const who = noP ? '편지의 주인' : pName;
  return [{ role: 'system', content: system.replaceAll('{{user}}', who) }, { role: 'user', content: user.replaceAll('{{user}}', who) }];
}

export function cleanEpilogue(raw, { ask = '', now = Date.now() } = {}) {
  const text = ss(raw?.text, 6000);
  if (!text) throw new Error('마무리 글이 비어 있습니다.');
  return { at: now, ask: ss(ask, 400), title: ss(raw?.title, 100) || (ask ? '그 후' : '마무리'), when: ss(raw?.when, 60), text };
}

// 마무리: 편지를 멈춘다(오가는 편지·쓰는 중인 답장은 그대로 얼어 있다). 되돌리면 다시 흐른다.
export function endCorrespondence(c, entry, now = Date.now()) {
  const st = storyOf(c);
  return { ...c, ended: { at: now }, initiativeAt: 0, story: { ...st, epilogue: [...st.epilogue, entry].slice(-40) } };
}
export function addAfter(c, entry) {
  const st = storyOf(c);
  return { ...c, story: { ...st, epilogue: [...st.epilogue, entry].slice(-40) } };
}
// 다시 잇기: 멈춰 있던 동안의 시간을 미룬다(도착·답장 시각이 그만큼 뒤로) — 돌아오자마자 한꺼번에 쏟아지지 않게
export function resumeCorrespondence(c, now = Date.now()) {
  if (!c.ended) return c;
  const gap = Math.max(0, now - (c.ended.at || now));
  const shift = (t) => (typeof t === 'number' && t ? t + gap : t);
  return {
    ...c,
    ended: null,
    letters: (c.letters || []).map((l) => (l.state === 'in_transit' ? { ...l, arriveAt: shift(l.arriveAt) } : l)),
    reply: c.reply && c.reply.state !== 'failed' ? { ...c.reply, dueAt: shift(c.reply.dueAt), nextTryAt: shift(c.reply.nextTryAt) } : c.reply,
    // 그쪽 시간도 멈춰 있었던 것으로: 기준 시각을 뒤로
    anchor: c.anchor ? { ...c.anchor, realAt: shift(c.anchor.realAt) } : c.anchor,
    initiativeAt: 0,
  };
}
