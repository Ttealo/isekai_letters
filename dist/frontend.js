// 이세계 우체통 공용 로직(백엔드·프런트·테스트가 같이 씀). 의존성 없음, 부수 효과 없음.
// 시각: 현실 시각은 ms(Date.now()), 상대 쪽 시각은 "만난 뒤 흐른 시간(시간 단위, 실수)".

export const HOUR = 3600 * 1000;
export const MINUTE = 60 * 1000;
export const RETRY_MINUTES = [1, 5, 30]; // 생성 실패 시 재시도 간격, 다 쓰면 failed
export const RECENT_LETTERS = 6; // 1단계: 프롬프트에 넣는 최근 원문 통수

export const DEFAULT_SETTINGS = {
  replyConnectionId: '', // 비면 사용자의 기본 연결(quiet)
  temperature: 0.9,
  maxTokens: 6000,
  recentLetters: RECENT_LETTERS,
  showExactEta: false, // 배송 중 남은 시간을 정확히(분 단위) 보여 줄지
};

const num = (v, lo, hi, d) => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) return d;
  return Math.min(hi, Math.max(lo, n));
};
const str = (v, max, d = '') => (typeof v === 'string' ? v.slice(0, max) : d);

export function newId(prefix, now = Date.now(), rand = Math.random) {
  return `${prefix}${now.toString(36)}${Math.floor(rand() * 1e8).toString(36)}`;
}

export function cleanSettings(s) {
  return {
    replyConnectionId: str(s?.replyConnectionId, 200),
    temperature: num(s?.temperature, 0, 2, DEFAULT_SETTINGS.temperature),
    maxTokens: Math.round(num(s?.maxTokens, 500, 32000, DEFAULT_SETTINGS.maxTokens)),
    recentLetters: Math.round(num(s?.recentLetters, 1, 20, RECENT_LETTERS)),
    showExactEta: !!s?.showExactEta,
  };
}

// ── 시간 ──

// timeScale: 시험용 가속(60이면 현실 1분이 1시간처럼 흐름). 실사용은 1.
const scaleOf = (c) => num(c?.timeScale, 1, 3600, 1);

// 현실 시각 → 상대 쪽 시각(만난 뒤 흐른 시간)
export function theirNow(c, now) {
  const a = c.anchor;
  return a.theirAt + ((now - a.realAt) / HOUR) * scaleOf(c) * c.ratio;
}

// 상대 쪽 시간(시간 단위) → 현실 ms
export function theirHoursToReal(c, theirHours) {
  return (theirHours / c.ratio / scaleOf(c)) * HOUR;
}

// 현실 시간(시간 단위) → 현실 ms (가속 반영)
export function realHours(c, hours) {
  return (hours / scaleOf(c)) * HOUR;
}

export function pickBetween(lo, hi, rand = Math.random) {
  return lo + (hi - lo) * rand();
}

// 상대 쪽 시각을 사람이 읽는 말로: "만난 지 12일째 저녁"
export function formatTheirTime(theirHours) {
  const h = Math.max(0, theirHours);
  const day = Math.floor(h / 24) + 1;
  const hour = Math.floor(h % 24);
  const part = hour < 5 ? '깊은 밤' : hour < 9 ? '새벽' : hour < 12 ? '아침' : hour < 14 ? '한낮' : hour < 18 ? '오후' : hour < 21 ? '저녁' : '밤';
  return `만난 지 ${day}일째 ${part}`;
}

// 흐른 시간 길이(시간 단위)를 말로
export function formatSpan(hours) {
  const h = Math.max(0, hours);
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}분`;
  if (h < 48) return `${Math.round(h)}시간`;
  const d = h / 24;
  if (d < 14) return `${Math.round(d)}일`;
  if (d < 60) return `${Math.round(d / 7)}주`;
  if (d < 730) return `${Math.round(d / 30)}달`;
  return `${(d / 365).toFixed(1)}년`;
}

// ── 상대 ──

export function cleanCorrespondentInput(p) {
  const name = str(p?.name, 80).trim();
  if (!name) throw new Error('상대 이름이 비어 있습니다.');
  const brief = str(p?.brief, 4000).trim();
  if (!brief) throw new Error('상대 설명이 비어 있습니다.');
  const dMin = num(p?.deliveryMin, 0.05, 72, 1);
  const dMax = num(p?.deliveryMax, dMin, 96, Math.max(dMin, 24));
  const wMin = num(p?.writeMin, 0, 24 * 365, 2);
  const wMax = num(p?.writeMax, wMin, 24 * 365 * 2, Math.max(wMin, 48));
  return {
    name,
    brief,
    world: str(p?.world, 4000).trim(),
    ratio: num(p?.ratio, 0.01, 1000, 1),
    delivery: { min: dMin, max: dMax },
    writeDelay: { min: wMin, max: wMax },
    maxReplyRealHours: num(p?.maxReplyRealHours, 0.1, 168, 24),
    timeScale: num(p?.timeScale, 1, 3600, 1),
    personaId: str(p?.personaId, 200),
  };
}

export function createCorrespondent(input, now = Date.now(), rand = Math.random) {
  const c = cleanCorrespondentInput(input);
  return {
    version: 1,
    id: newId('c', now, rand),
    ...c,
    anchor: { realAt: now, theirAt: pickBetween(8, 20, rand) }, // 그쪽은 1일째 아침~저녁 어딘가에서 시작
    createdAt: now,
    letters: [],
    reply: null, // { state:'waiting'|'generating'|'failed', dueAt, attempts, nextTryAt, error, forLetterIds }
  };
}

// 저장된 상대 → 입력 양식(수정 화면용)
export function toInput(c) {
  return {
    name: c.name, brief: c.brief, world: c.world, ratio: c.ratio,
    deliveryMin: c.delivery.min, deliveryMax: c.delivery.max,
    writeMin: c.writeDelay.min, writeMax: c.writeDelay.max,
    maxReplyRealHours: c.maxReplyRealHours, timeScale: scaleOf(c), personaId: c.personaId,
  };
}

export function updateCorrespondent(c, input, now = Date.now()) {
  const next = cleanCorrespondentInput({ ...toInput(c), ...input });
  const out = { ...c, ...next };
  // 비율이나 가속이 바뀌면 지금을 새 기준점으로(지난 날짜는 그대로)
  if (next.ratio !== c.ratio || next.timeScale !== scaleOf(c)) {
    out.anchor = { realAt: now, theirAt: theirNow(c, now) };
  }
  return out;
}

// ── 편지 ──

export function cleanLetterBody(v) {
  const body = str(v, 20000).trim();
  if (!body) throw new Error('편지 본문이 비어 있습니다.');
  return body;
}

// 내가 보내는 편지
export function sendLetter(c, { body, enclosure, personaName }, now = Date.now(), rand = Math.random) {
  const travel = realHours(c, pickBetween(c.delivery.min, c.delivery.max, rand));
  const letter = {
    id: newId('l', now, rand),
    from: 'me',
    personaName: str(personaName, 80),
    body: cleanLetterBody(body),
    enclosure: str(enclosure, 500).trim(),
    sentAt: now,
    arriveAt: now + travel,
    theirSentAt: theirNow(c, now),
    theirArriveAt: theirNow(c, now + travel),
    state: 'in_transit',
  };
  return { ...c, letters: [...c.letters, letter] };
}

// 배송 중일 때만 회수
export function recallLetter(c, letterId, now = Date.now()) {
  const l = c.letters.find((x) => x.id === letterId);
  if (!l || l.from !== 'me') throw new Error('회수할 편지를 찾지 못했습니다.');
  if (l.state !== 'in_transit' || now >= l.arriveAt) throw new Error('이미 도착한 편지는 회수할 수 없습니다.');
  return { ...c, letters: c.letters.filter((x) => x.id !== letterId) };
}

export function markOpened(c, letterId, now = Date.now()) {
  return {
    ...c,
    letters: c.letters.map((l) => (l.id === letterId && l.from === 'them' && l.state === 'delivered' ? { ...l, state: 'opened', openedAt: now } : l)),
  };
}

// ── 시간 진행: 저장된 상대 하나를 지금 시각까지 진행시킨다 ──
// 반환: { c, generate: bool(답장 생성이 필요), delivered: [letterId] }
export function advance(c, now = Date.now(), rand = Math.random) {
  let out = c;
  const delivered = [];
  // 1) 내 편지 도착
  const arrivedNow = [];
  const letters = out.letters.map((l) => {
    if (l.from === 'me' && l.state === 'in_transit' && now >= l.arriveAt) {
      arrivedNow.push(l);
      return { ...l, state: 'arrived' };
    }
    return l;
  });
  out = { ...out, letters };
  // 2) 답장 작업 만들기(이미 기다리는 작업이 있으면 그 작업이 새 편지까지 함께 답한다)
  if (arrivedNow.length) {
    const ids = arrivedNow.map((l) => l.id);
    if (out.reply && out.reply.state !== 'failed') {
      out = { ...out, reply: { ...out.reply, forLetterIds: [...new Set([...out.reply.forLetterIds, ...ids])] } };
    } else {
      const first = arrivedNow.reduce((a, b) => (a.arriveAt <= b.arriveAt ? a : b));
      const theirWrite = pickBetween(c.writeDelay.min, c.writeDelay.max, rand);
      const realWrite = Math.min(theirHoursToReal(out, theirWrite), realHours(out, out.maxReplyRealHours));
      out = {
        ...out,
        reply: { state: 'waiting', dueAt: first.arriveAt + realWrite, attempts: 0, nextTryAt: 0, error: '', forLetterIds: ids },
      };
    }
  }
  // 3) 상대 편지 배달
  out = {
    ...out,
    letters: out.letters.map((l) => {
      if (l.from === 'them' && l.state === 'in_transit' && now >= l.arriveAt) {
        delivered.push(l.id);
        return { ...l, state: 'delivered' };
      }
      return l;
    }),
  };
  const r = out.reply;
  const generate = !!r && r.state === 'waiting' && now >= r.dueAt && now >= (r.nextTryAt || 0);
  return { c: out, generate, delivered };
}

// 생성 중에 서버가 꺼졌던 작업을 되돌린다(시작할 때 한 번)
export function recover(c) {
  if (c.reply?.state === 'generating') return { ...c, reply: { ...c.reply, state: 'waiting', nextTryAt: 0 } };
  return c;
}

export function markGenerating(c) {
  return { ...c, reply: { ...c.reply, state: 'generating' } };
}

export function markFailed(c, error, now = Date.now()) {
  const r = c.reply;
  const attempts = (r?.attempts || 0) + 1;
  const wait = RETRY_MINUTES[attempts - 1];
  const msg = str(error?.message || String(error), 500);
  if (wait === undefined) return { ...c, reply: { ...r, state: 'failed', attempts, error: msg } };
  return { ...c, reply: { ...r, state: 'waiting', attempts, nextTryAt: now + wait * MINUTE, error: msg } };
}

// 실패한 답장을 다시 시도
export function retryReply(c, now = Date.now()) {
  if (c.reply?.state !== 'failed') throw new Error('다시 시도할 답장이 없습니다.');
  return { ...c, reply: { ...c.reply, state: 'waiting', attempts: 0, nextTryAt: 0, dueAt: Math.min(c.reply.dueAt, now), error: '' } };
}

// 생성 결과를 상대 편지로 넣고 배송을 시작한다
export function applyReply(c, reply, now = Date.now(), rand = Math.random) {
  const travel = realHours(c, pickBetween(c.delivery.min, c.delivery.max, rand));
  const letter = {
    id: newId('l', now, rand),
    from: 'them',
    body: reply.body,
    ps: reply.ps,
    envelope: reply.envelope,
    enclosures: reply.enclosures,
    between: reply.between,
    theirWrittenAt: theirNow(c, now),
    theirReadAt: reply.readAt,
    writtenLabel: reply.writtenAt,
    answers: c.reply?.forLetterIds || [],
    sentAt: now,
    arriveAt: now + travel,
    state: 'in_transit',
  };
  return { ...c, letters: [...c.letters, letter], reply: null };
}

// ── 생성 결과 읽기 ──

export function parseJsonLoose(text) {
  if (typeof text !== 'string') throw new Error('응답이 글이 아닙니다.');
  let t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('응답에서 JSON을 찾지 못했습니다.');
  return JSON.parse(t.slice(a, b + 1));
}

const cleanList = (v, max, fn) => (Array.isArray(v) ? v.slice(0, max).map(fn).filter(Boolean) : []);

export function cleanReply(raw) {
  const body = str(raw?.body, 20000).trim();
  if (!body) throw new Error('답장 본문이 비어 있습니다.');
  const e = raw?.envelope || {};
  return {
    body,
    ps: str(raw?.ps, 2000).trim(),
    readAt: str(raw?.read_at, 200),
    writtenAt: str(raw?.written_at, 200),
    envelope: {
      medium: str(e.medium, 200), texture: str(e.texture, 500), scent: str(e.scent, 500),
      marks: str(e.marks, 500), seal: str(e.seal, 500), stamp: str(e.stamp, 500),
    },
    enclosures: cleanList(raw?.enclosures, 5, (x) => (str(x?.item, 200) ? { item: str(x.item, 200), note: str(x?.note, 500) } : null)),
    between: cleanList(raw?.between, 30, (x) => (str(x?.event, 1000) ? { when: str(x?.their_date, 200), event: str(x.event, 1000), senses: str(x?.senses, 500), open: !!x?.open } : null)),
  };
}

// ── 프롬프트 ──

const letterText = (l, c) => {
  if (l.from === 'me') {
    const head = `[{{user}} → ${c.name}] 보낸 날(그쪽 기준) ${formatTheirTime(l.theirSentAt)} / 도착 ${formatTheirTime(l.theirArriveAt)}`;
    return `${head}\n${l.body}${l.enclosure ? `\n(동봉: ${l.enclosure})` : ''}`;
  }
  const head = `[${c.name} → {{user}}] 쓴 날 ${formatTheirTime(l.theirWrittenAt)}`;
  return `${head}\n${l.body}${l.ps ? `\n추신: ${l.ps}` : ''}${l.enclosures?.length ? `\n(동봉: ${l.enclosures.map((x) => x.item).join(', ')})` : ''}`;
};

export function buildReplyMessages(c, { now = Date.now(), personaName = '', recent = RECENT_LETTERS } = {}) {
  const userName = personaName || '편지의 주인';
  const answered = new Set(c.reply?.forLetterIds || []);
  const unanswered = c.letters.filter((l) => l.from === 'me' && answered.has(l.id));
  const firstArrival = unanswered.length ? Math.min(...unanswered.map((l) => l.theirArriveAt)) : theirNow(c, now);
  const lastTheirs = [...c.letters].reverse().find((l) => l.from === 'them');
  const tNow = theirNow(c, now);
  const pastLetters = c.letters.filter((l) => !(l.from === 'me' && l.state === 'in_transit'));
  const shown = pastLetters.slice(-recent);
  const omitted = pastLetters.length - shown.length;

  const system = [
    '<system>',
    `You are ${c.name}, living in another world, writing a letter by hand to {{user}}.`,
    'This is correspondence, not chat. You never see {{user}}; you only know what their letters said.',
    'Write only as yourself. Never decide {{user}}\'s actions, feelings, or replies.',
    '</system>',
    '',
    '<character>',
    c.brief,
    '</character>',
    c.world ? `\n<world>\n${c.world}\n</world>` : '',
    '',
    '<correspondence>',
    `their_now=${formatTheirTime(tNow)}`,
    `ratio=1:${c.ratio} (your time / {{user}}'s time; ${c.ratio > 1 ? `one day for {{user}} is ${formatSpan(24 * c.ratio)} for you` : c.ratio < 1 ? `one day for {{user}} is only ${formatSpan(24 * c.ratio)} for you` : 'same speed'})`,
    `letters_arrived=${unanswered.length}통, first arrived ${formatTheirTime(firstArrival)}`,
    lastTheirs ? `since_your_last_letter=${formatSpan(tNow - lastTheirs.theirWrittenAt)}` : 'first_reply=yes (this is your first letter to {{user}})',
    `knows_about_user=only what their letters said; their name is ${userName}`,
    omitted > 0 ? `older_letters_omitted=${omitted}통 (not shown here)` : '',
    '</correspondence>',
    '',
    '<task>',
    '1. First write `between`: what happened to you from receiving the letter until finishing this reply, in your own time. Scale detail to the elapsed time; summarize long spans coarsely. Include at least one sensory detail per event.',
    '2. Then write the letter. Let only some of `between` show through, the way people actually write letters: hints, omissions, a shaky hand.',
    '3. Respond to what {{user}} actually wrote. Answer or deliberately avoid their questions.',
    '4. The letter must feel like a physical object from your world: describe `envelope` and any `enclosures` in concrete sensory terms.',
    '5. Stay consistent with the character and world above. New facts are allowed when they follow from events.',
    'Output JSON only, in Korean, with this shape:',
    '{"between":[{"their_date":"","event":"","senses":"","open":false}],"read_at":"","written_at":"","envelope":{"medium":"","texture":"","scent":"","marks":"","seal":"","stamp":""},"enclosures":[{"item":"","note":""}],"body":"","ps":""}',
    '</task>',
  ].filter((x) => x !== '').join('\n').replaceAll('{{user}}', userName);

  const history = shown.map((l) => letterText(l, c)).join('\n\n---\n\n').replaceAll('{{user}}', userName);
  const user = `<letters>\n${history || '(아직 편지 없음)'}\n</letters>\n\n위 편지에 답장을 쓴다. JSON만 출력.`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

// ── 화면용 요약 ──

export function summarize(c, now = Date.now()) {
  const unread = c.letters.filter((l) => l.from === 'them' && l.state === 'delivered').length;
  const inTransit = c.letters.filter((l) => l.state === 'in_transit').length;
  const lastLetter = c.letters[c.letters.length - 1] || null;
  const lastThem = [...c.letters].reverse().find((l) => l.from === 'them');
  const lastMine = [...c.letters].reverse().find((l) => l.from === 'me');
  const tNow = theirNow(c, now);
  let status = '아직 편지가 없습니다';
  if (c.reply?.state === 'failed') status = '우편 사고 — 답장을 만들지 못했습니다';
  else if (c.reply) status = '답장을 쓰는 중인 듯합니다';
  else if (lastMine && lastMine.state === 'in_transit') status = '편지가 가는 중';
  else if (lastLetter?.from === 'them' && lastLetter.state === 'in_transit') status = '답장이 오는 중';
  else if (lastThem && (!lastMine || lastMine.sentAt < lastThem.sentAt)) status = `그쪽은 ${formatSpan(tNow - lastThem.theirWrittenAt)}째 내 답장을 기다리는 중`;
  return {
    id: c.id, name: c.name, ratio: c.ratio, theirNow: formatTheirTime(tNow),
    unread, inTransit, status, failed: c.reply?.state === 'failed', error: c.reply?.error || '',
    lastAt: lastLetter ? lastLetter.sentAt : c.createdAt,
  };
}

// 상대에게 보이지 않는 정보(생성 전 답장, 배송 중 답장의 본문)를 가린 사본
export function publicView(c, now = Date.now()) {
  return {
    ...c,
    theirNowLabel: formatTheirTime(theirNow(c, now)),
    letters: c.letters.map((l) => {
      if (l.from === 'them' && l.state === 'in_transit') return { id: l.id, from: 'them', state: 'in_transit', sentAt: l.sentAt, arriveAt: l.arriveAt };
      if (l.from === 'them') {
        const { between, ...rest } = l; // 사이 일지는 상대의 사정 — 화면에는 내지 않는다(3단계 연대기에서 일부 공개)
        return { ...rest, theirWrittenLabel: formatTheirTime(l.theirWrittenAt) };
      }
      return { ...l, theirSentLabel: formatTheirTime(l.theirSentAt), theirArriveLabel: formatTheirTime(l.theirArriveAt) };
    }),
  };
}

export function etaLabel(ms, exact) {
  if (ms <= 0) return '곧 도착';
  const h = ms / HOUR;
  if (exact) {
    const hh = Math.floor(h);
    const mm = Math.round((h - hh) * 60);
    return `도착까지 ${hh ? `${hh}시간 ` : ''}${mm}분`;
  }
  if (h < 1) return '거의 다 왔습니다';
  if (h < 3) return '도착까지 두어 시간';
  return `도착까지 약 ${Math.round(h)}시간`;
}


// 이세계 우체통 프런트 — 서랍 탭 하나.
// 화면: 우편함(상대 목록) / 상대(편지 묶음 + 쓰기) / 편지 열기(봉투 → 본문) / 새 상대·수정 / 설정
// 모든 글은 textContent로만 넣는다(생성된 글에 HTML이 섞여도 실행되지 않게).

const CSS = `
.im-tab{display:flex;flex-direction:column;gap:12px;padding:12px;color:var(--lumiverse-text);font-size:13px;line-height:1.6}
.im-tab h3{margin:0;font-size:15px}
.im-tab h4{margin:4px 0 0;font-size:13px}
.im-muted{color:var(--lumiverse-text-muted);font-size:12px}
.im-err{color:var(--lumiverse-danger);font-size:12px}
.im-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.im-grow{flex:1}
.im-tab textarea,.im-tab input,.im-tab select{width:100%;box-sizing:border-box;background:var(--lumiverse-fill);color:var(--lumiverse-text);border:1px solid var(--lumiverse-border);border-radius:var(--lumiverse-radius,6px);padding:6px 8px;font:inherit}
.im-tab textarea{min-height:90px;resize:vertical}
.im-tab label{display:flex;flex-direction:column;gap:3px;font-size:12px;color:var(--lumiverse-text-muted)}
.im-pair{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.im-btn{background:var(--lumiverse-fill);color:var(--lumiverse-text);border:1px solid var(--lumiverse-border);border-radius:var(--lumiverse-radius,6px);padding:5px 12px;cursor:pointer;font:inherit}
.im-btn.im-primary{background:var(--lumiverse-primary);color:#fff;border-color:transparent}
.im-btn:disabled{opacity:.5;cursor:default}
.im-link{background:none;border:none;color:var(--lumiverse-primary);cursor:pointer;padding:0;font:inherit}
.im-card{border:1px solid var(--lumiverse-border);border-radius:var(--lumiverse-radius,8px);padding:10px 12px;background:var(--lumiverse-fill-subtle,transparent);cursor:pointer;display:flex;flex-direction:column;gap:2px}
.im-card:hover{border-color:var(--lumiverse-primary)}
.im-badge{display:inline-block;min-width:18px;padding:0 6px;border-radius:9px;background:var(--lumiverse-primary);color:#fff;font-size:11px;text-align:center}
.im-letter{border:1px solid var(--lumiverse-border);border-radius:var(--lumiverse-radius,8px);padding:10px 12px;display:flex;flex-direction:column;gap:4px}
.im-letter.im-mine{margin-left:18px;opacity:.92}
.im-letter.im-theirs{margin-right:18px}
.im-paper{font-family:"Nanum Myeongjo","Noto Serif KR",Georgia,serif;white-space:pre-wrap;font-size:14px;line-height:1.85;padding:16px 18px;border-radius:var(--lumiverse-radius,8px);background:color-mix(in srgb,var(--lumiverse-fill) 70%,#c8a46a 12%);border:1px solid color-mix(in srgb,var(--lumiverse-border) 60%,#c8a46a 40%)}
.im-envelope{display:flex;flex-direction:column;gap:6px;padding:16px;border-radius:var(--lumiverse-radius,8px);border:1px dashed color-mix(in srgb,var(--lumiverse-border) 50%,#c8a46a 50%);background:color-mix(in srgb,var(--lumiverse-fill) 80%,#c8a46a 8%)}
.im-envelope dt{font-size:11px;color:var(--lumiverse-text-muted)}
.im-envelope dd{margin:0 0 4px}
.im-sep{border:none;border-top:1px solid var(--lumiverse-border);margin:4px 0}
`;
const ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 8l9 6 9-6"/><path d="M15 3.5l2 1.2"/></svg>';

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k in node) node[k] = v;
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c !== null && c !== undefined && c !== false) node.append(c);
  return node;
}
const btn = (text, onclick, opts = {}) => el('button', { class: `im-btn${opts.primary ? ' im-primary' : ''}`, type: 'button', text, disabled: !!opts.disabled, onclick });
const link = (text, onclick) => el('button', { class: 'im-link', type: 'button', text, onclick });
const field = (label, input) => el('label', {}, [label, input]);
const when = (ms) => new Date(ms).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export function setup(ctx) {
  const waits = new Map();
  let seq = 0;
  const offBack = ctx.onBackendMessage((msg) => {
    if (msg?.type === 'changed' && !msg.requestId) { onChanged(msg); return; }
    const w = msg && waits.get(msg.requestId);
    if (!w) return;
    waits.delete(msg.requestId);
    if (msg.ok) w.resolve(msg); else w.reject(new Error(msg.error || '실패'));
  });
  const ask = (type, extra = {}, timeout = 20000) => new Promise((resolve, reject) => {
    const requestId = `im${Date.now()}_${seq++}`;
    waits.set(requestId, { resolve, reject });
    ctx.sendToBackend({ requestId, type, ...extra });
    setTimeout(() => { if (waits.delete(requestId)) reject(new Error('응답 없음')); }, timeout);
  });

  const tab = ctx.ui.registerDrawerTab({
    id: 'isekai-mailbox', title: '이세계 우체통', shortName: '우체통',
    description: '다른 세계의 누군가와 주고받는 편지',
    keywords: ['letter', 'mail', 'post', '편지', '우체통', '이세계'],
    headerTitle: '이세계 우체통', iconSvg: ICON,
  });
  const removeStyle = typeof ctx.dom?.addStyle === 'function' ? ctx.dom.addStyle(CSS) : null;
  if (!removeStyle) tab.root.append(el('style', { text: CSS }));
  const root = el('div', { class: 'im-tab' });
  tab.root.append(root);

  // 상태
  let view = { name: 'home' };
  let list = [];
  let settings = null;
  let current = null; // 열려 있는 상대(publicView)
  let currentInput = null;
  let error = '';
  let busy = false;
  let draft = { body: '', enclosure: '' };

  const setError = (e) => { error = e ? (e.message || String(e)) : ''; };
  const go = (v) => { view = v; error = ''; render(); };

  async function loadHome() {
    try {
      const r = await ask('load');
      list = r.list;
      settings = r.settings;
      const unread = list.reduce((n, x) => n + x.unread, 0);
      tab.setBadge(unread ? String(unread) : null);
    } catch (e) { setError(e); }
  }
  async function loadC(id) {
    try {
      const r = await ask('get', { id });
      current = r.c;
      currentInput = r.input;
    } catch (e) { setError(e); }
  }
  async function refresh() {
    await loadHome();
    if ((view.name === 'c' || view.name === 'letter') && view.id) await loadC(view.id);
    render();
  }
  function onChanged() { refresh(); }
  const offActivate = tab.onActivate(() => refresh());
  const timer = setInterval(() => { if (view.name === 'c' || view.name === 'home') refresh(); }, 60 * 1000);

  const act = async (fn) => {
    if (busy) return;
    busy = true; setError(null); render();
    try { await fn(); } catch (e) { setError(e); }
    busy = false; render();
  };

  // ── 화면 ──
  function render() {
    const body = { home: homeView, c: cView, letter: letterView, form: formView, settings: settingsView }[view.name]?.() || [];
    root.replaceChildren(...[].concat(body, error ? el('div', { class: 'im-err', text: error }) : null).filter(Boolean));
  }

  function homeView() {
    return [
      el('div', { class: 'im-row' }, [
        el('h3', { class: 'im-grow', text: '우편함' }),
        btn('새 상대', () => { currentInput = null; go({ name: 'form' }); }, { primary: true }),
        btn('설정', () => go({ name: 'settings' })),
      ]),
      list.length ? null : el('div', { class: 'im-muted', text: '아직 편지를 주고받는 상대가 없습니다. 「새 상대」에서 누구에게 편지를 보낼지 적어 주세요.' }),
      ...list.map((x) => el('div', { class: 'im-card', onclick: () => openC(x.id) }, [
        el('div', { class: 'im-row' }, [
          el('b', { class: 'im-grow', text: x.name }),
          x.unread ? el('span', { class: 'im-badge', text: String(x.unread) }) : null,
        ]),
        el('div', { class: 'im-muted', text: `그쪽은 지금 ${x.theirNow} · 시간 1:${x.ratio}` }),
        el('div', { class: x.failed ? 'im-err' : 'im-muted', text: x.status }),
      ])),
    ];
  }

  async function openC(id) {
    view = { name: 'c', id };
    draft = { body: '', enclosure: '' };
    await loadC(id);
    render();
  }

  function cView() {
    const c = current;
    if (!c || c.id !== view.id) return [el('div', { class: 'im-muted', text: '불러오는 중…' })];
    const now = Date.now();
    const exact = !!settings?.showExactEta;
    const items = c.letters.slice().reverse().map((l) => {
      if (l.from === 'me') {
        return el('div', { class: 'im-letter im-mine' }, [
          el('div', { class: 'im-muted', text: `보낸 편지 · ${when(l.sentAt)} · 그쪽 ${l.theirSentLabel}` }),
          el('div', { text: l.body.length > 140 ? `${l.body.slice(0, 140)}…` : l.body }),
          l.state === 'in_transit'
            ? el('div', { class: 'im-row' }, [el('span', { class: 'im-muted im-grow', text: etaLabel(l.arriveAt - now, exact) }), link('회수하기', () => act(async () => {
              if (!confirm('이 편지를 회수할까요? 상대에게 가지 않습니다.')) return;
              current = (await ask('recall', { id: c.id, letterId: l.id })).c;
              await loadHome();
            }))])
            : el('div', { class: 'im-muted', text: `도착함 · 그쪽 ${l.theirArriveLabel}` }),
        ]);
      }
      if (l.state === 'in_transit') {
        return el('div', { class: 'im-letter im-theirs' }, [
          el('div', { class: 'im-muted', text: `${c.name}의 편지가 오는 중` }),
          el('div', { text: exact ? etaLabel(l.arriveAt - now, true) : '어딘가를 건너는 중…' }),
        ]);
      }
      return el('div', { class: 'im-letter im-theirs', onclick: () => openLetter(l.id) }, [
        el('div', { class: 'im-row' }, [
          el('b', { class: 'im-grow', text: l.state === 'delivered' ? '새 편지' : `${c.name}의 편지` }),
          l.state === 'delivered' ? el('span', { class: 'im-badge', text: '!' }) : null,
        ]),
        el('div', { class: 'im-muted', text: `도착 ${when(l.arriveAt)} · 그쪽 ${l.theirWrittenLabel}에 씀` }),
        l.state === 'opened' ? el('div', { text: l.body.length > 100 ? `${l.body.slice(0, 100)}…` : l.body }) : el('div', { class: 'im-muted', text: l.envelope?.medium ? `봉투: ${l.envelope.medium}` : '봉투가 닫혀 있습니다' }),
      ]);
    });
    const s = list.find((x) => x.id === c.id);
    return [
      el('div', { class: 'im-row' }, [link('← 우편함', () => go({ name: 'home' })), el('span', { class: 'im-grow' }), link('상대 정보 수정', () => go({ name: 'form', id: c.id }))]),
      el('h3', { text: c.name }),
      el('div', { class: 'im-muted', text: `그쪽은 지금 ${c.theirNowLabel} · 시간 1:${c.ratio} (나의 하루 = 그쪽 ${formatSpan(24 * c.ratio)})` }),
      s ? el('div', { class: s.failed ? 'im-err' : 'im-muted', text: s.status }) : null,
      c.reply?.state === 'failed' ? el('div', { class: 'im-row' }, [
        el('span', { class: 'im-err im-grow', text: `사유: ${c.reply.error || '알 수 없음'}` }),
        btn('다시 시도', () => act(async () => { await ask('retry', { id: c.id }); await refresh(); })),
      ]) : null,
      composeView(c),
      el('hr', { class: 'im-sep' }),
      ...(items.length ? items : [el('div', { class: 'im-muted', text: '아직 주고받은 편지가 없습니다.' })]),
    ];
  }

  function composeView(c) {
    const ta = el('textarea', { value: draft.body, placeholder: `${c.name}에게 쓰는 편지`, rows: 7, oninput: (e) => { draft.body = e.target.value; } });
    const enc = el('input', { value: draft.enclosure, placeholder: '동봉할 것(선택) — 예: 말린 네잎클로버 한 장', oninput: (e) => { draft.enclosure = e.target.value; } });
    return el('div', { class: 'im-letter' }, [
      el('h4', { text: '편지 쓰기' }),
      ta, enc,
      el('div', { class: 'im-row' }, [
        el('span', { class: 'im-muted im-grow', text: `배송 ${c.delivery.min}~${c.delivery.max}시간. 도착 전에는 회수할 수 있습니다.` }),
        btn(busy ? '보내는 중…' : '보내기', () => act(async () => {
          if (!draft.body.trim()) throw new Error('본문을 적어 주세요.');
          current = (await ask('send', { id: c.id, body: draft.body, enclosure: draft.enclosure })).c;
          draft = { body: '', enclosure: '' };
          await loadHome();
        }), { primary: true, disabled: busy }),
      ]),
    ]);
  }

  async function openLetter(letterId) {
    view = { name: 'letter', id: current.id, letterId, step: 'envelope' };
    render();
  }

  function letterView() {
    const c = current;
    const l = c?.letters.find((x) => x.id === view.letterId);
    if (!l) return [link('← 돌아가기', () => openC(view.id))];
    const back = el('div', { class: 'im-row' }, [link(`← ${c.name}`, () => openC(c.id))]);
    const e = l.envelope || {};
    if (view.step === 'envelope' && l.state === 'delivered') {
      const rows = [['매체', e.medium], ['손끝에 닿는 것', e.texture], ['냄새', e.scent], ['흔적', e.marks], ['봉인', e.seal], ['우표', e.stamp]].filter(([, v]) => v);
      return [
        back,
        el('div', { class: 'im-envelope' }, [
          el('div', { class: 'im-muted', text: `${when(l.arriveAt)}에 도착한 편지` }),
          el('dl', {}, rows.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })])),
          l.enclosures?.length ? el('div', { class: 'im-muted', text: `안에 무언가 더 들어 있는 것 같습니다 (${l.enclosures.length})` }) : null,
        ]),
        btn('봉투 열기', () => act(async () => {
          current = (await ask('open', { id: c.id, letterId: l.id })).c;
          view = { ...view, step: 'body' };
          await loadHome();
        }), { primary: true }),
      ];
    }
    const meta = [e.medium, e.scent].filter(Boolean).join(' · ');
    return [
      back,
      el('div', { class: 'im-muted', text: `${l.writtenLabel || l.theirWrittenLabel}${meta ? ` · ${meta}` : ''}` }),
      el('div', { class: 'im-paper', text: l.body + (l.ps ? `\n\n추신. ${l.ps}` : '') }),
      ...(l.enclosures || []).map((x) => el('div', { class: 'im-envelope' }, [el('b', { text: `동봉: ${x.item}` }), x.note ? el('div', { text: x.note }) : null])),
      el('div', { class: 'im-muted', text: `받은 시각 ${when(l.arriveAt)}` }),
    ];
  }

  // 새 상대 / 수정
  function formView() {
    const editing = !!view.id;
    const v = editing && currentInput ? { ...currentInput } : {
      name: '', brief: '', world: '', ratio: 1, deliveryMin: 1, deliveryMax: 24, writeMin: 2, writeMax: 48, maxReplyRealHours: 24, timeScale: 1, personaId: '',
    };
    const inputs = {};
    const text = (k, ph, rows) => (inputs[k] = rows ? el('textarea', { value: v[k] || '', placeholder: ph, rows }) : el('input', { value: v[k] ?? '', placeholder: ph }));
    const numIn = (k, step = 'any') => (inputs[k] = el('input', { type: 'number', step, min: '0', value: String(v[k] ?? '') }));
    const read = () => Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value]));
    return [
      el('div', { class: 'im-row' }, [link('← 돌아가기', () => (editing ? openC(view.id) : go({ name: 'home' })))]),
      el('h3', { text: editing ? '상대 정보 수정' : '새 상대' }),
      el('div', { class: 'im-muted', text: '1단계 버전: 상대를 직접 적습니다. 캐릭터 카드·로어북 자동 생성과 무작위 매칭은 다음 단계에서 붙습니다.' }),
      field('이름', text('name', '예: 하르텐')),
      field('상대 설명 (성격·말투·처지 — 캐릭터 카드처럼 적어도 됩니다)', text('brief', '눈 덮인 곶의 등대지기. 무뚝뚝하지만 편지는 꼬박꼬박 길게 쓴다…', 6)),
      field('그쪽 세계 (선택)', text('world', '바다가 얼어붙는 북쪽 해안. 우편은 철새 다리에 묶어 보낸다…', 4)),
      el('h4', { text: '시간' }),
      el('div', { class: 'im-pair' }, [
        field('시간 비율 (나의 1 = 그쪽 ?)', numIn('ratio')),
        field('답장까지 현실 최대(시간)', numIn('maxReplyRealHours')),
        field('배송 최소(현실 시간)', numIn('deliveryMin')),
        field('배송 최대(현실 시간)', numIn('deliveryMax')),
        field('답장 쓰는 데 최소(그쪽 시간)', numIn('writeMin')),
        field('답장 쓰는 데 최대(그쪽 시간)', numIn('writeMax')),
      ]),
      el('details', {}, [
        el('summary', { class: 'im-muted', text: '시험용' }),
        field('시간 가속 (1=실제, 60=현실 1분이 1시간)', numIn('timeScale')),
      ]),
      el('div', { class: 'im-row' }, [
        btn(editing ? '저장' : '만들기', () => act(async () => {
          if (editing) {
            current = (await ask('update', { id: view.id, input: read() })).c;
            await loadHome();
            await openC(view.id);
          } else {
            const r = await ask('create', { input: read() });
            await loadHome();
            await openC(r.id);
          }
        }), { primary: true, disabled: busy }),
        editing ? btn('상대 지우기', () => act(async () => {
          if (!confirm('이 상대와 주고받은 편지를 모두 지울까요? 되돌릴 수 없습니다.')) return;
          await ask('delete', { id: view.id });
          await loadHome();
          go({ name: 'home' });
        })) : null,
      ]),
    ];
  }

  let connections = null;
  function settingsView() {
    const s = { ...(settings || {}) };
    if (!connections) {
      connections = [];
      ask('connections').then((r) => { connections = r.connections; render(); }).catch((e) => { setError(e); render(); });
    }
    const sel = el('select', {}, [
      el('option', { value: '', text: '기본 연결 사용' }),
      ...connections.map((x) => el('option', { value: x.id, text: `${x.name} — ${x.model || x.provider}${x.is_default ? ' (기본)' : ''}`, selected: x.id === s.replyConnectionId })),
    ]);
    const temp = el('input', { type: 'number', step: '0.05', min: '0', max: '2', value: String(s.temperature ?? 0.9) });
    const maxT = el('input', { type: 'number', step: '100', min: '500', value: String(s.maxTokens ?? 6000) });
    const recent = el('input', { type: 'number', step: '1', min: '1', max: '20', value: String(s.recentLetters ?? 6) });
    const exact = el('input', { type: 'checkbox', checked: !!s.showExactEta });
    return [
      el('div', { class: 'im-row' }, [link('← 우편함', () => go({ name: 'home' }))]),
      el('h3', { text: '설정' }),
      field('답장 쓰기 연결', sel),
      el('div', { class: 'im-pair' }, [field('온도', temp), field('최대 출력 토큰', maxT)]),
      field('프롬프트에 넣는 최근 편지 수(양쪽 합)', recent),
      el('label', { class: 'im-row' }, [exact, '배송 중 남은 시간을 분 단위로 보기']),
      el('div', { class: 'im-muted', text: '연결에 붙은 프리셋은 쓰지 않고, 우체통이 자기 지시문과 위 값을 보냅니다.' }),
      btn('저장', () => act(async () => {
        settings = (await ask('saveSettings', { settings: { replyConnectionId: sel.value, temperature: temp.value, maxTokens: maxT.value, recentLetters: recent.value, showExactEta: exact.checked } })).settings;
        go({ name: 'home' });
      }), { primary: true }),
    ];
  }

  loadHome().then(render);
  render();

  return () => {
    clearInterval(timer);
    offActivate?.();
    offBack?.();
    removeStyle?.();
    tab.destroy();
  };
}

