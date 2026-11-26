// 이미지(소품 일러스트): 설정 정리, 그림 프롬프트 만들기, 하루 상한. 부수 효과 없음.
// 편지지·우표·봉인은 "그래픽 도안"(정면 평면, 배경·탁자·그림자 없음), 물건은 세밀한 일러스트.
// 사람·얼굴·손·글자는 그리지 않는다. 종류마다 양식(템플릿)과 모델을 설정에서 바꿀 수 있다.

export const ART_KINDS = ['paper', 'stamp', 'seal'];
export const ALL_KINDS = ['paper', 'stamp', 'seal', 'item'];
export const ART_LABEL = { paper: '편지지', stamp: '우표', seal: '봉인', item: '물건' };

export const DEFAULT_STYLE = 'hand-painted storybook illustration, delicate ink linework, soft watercolor washes, muted vintage palette, not a photograph';
export const NEGATIVE = 'photo, photograph, photorealistic, realistic, 3d render, table, desk, wooden surface, background scene, perspective, shadow, people, person, face, hands, fingers, human figure, text, letters, writing, words, numbers, digits, watermark, signature, logo';

// {subject} = 글 생성이 써 준 영어 주제, {style} = 전체 룩
export const DEFAULT_TEMPLATES = {
  paper: 'flat 2D stationery design printed on cream paper, straight-on front view filling the entire frame edge to edge, ornamental border and small corner vignettes showing {subject}, large completely blank center area for handwriting, {style}, no table, no background, no shadows, no perspective, no lettering',
  stamp: 'flat 2D postage stamp design, straight-on front view filling the whole frame, white perforated edge, vintage engraved illustration of {subject}, two or three ink colors, printed paper texture, {style}, no denomination, no lettering, no numbers',
  seal: 'flat 2D illustration of a seal impression seen from directly above, {subject}, engraved relief detail, centered on plain cream background, {style}, no lettering',
  item: 'highly detailed illustration of {subject}, intricate textures and small details, fine ink linework with layered watercolor, soft natural light, single object centered on plain warm paper background, {style}, no lettering',
};

export const DEFAULT_ART = {
  connectionId: '', // 비면 앱 기본 이미지 연결
  model: '', // 기본 모델(비면 연결의 모델)
  style: DEFAULT_STYLE,
  size: '1024x1024',
  paperSize: '1024x1024',
  perDay: 6, // 하루 전체 장수(세트 포함)
  autoItems: 'off', // 'off' | 'all'
  sendNegative: false, // 금지어를 negative_prompt로 보낼지(받지 않는 모델이 많음 — 거절되면 빼고 다시 시도)
  negative: NEGATIVE,
  paperStrength: 70, // 편지지 가운데 글씨 칸을 덮는 크림색의 옅기(100=안 덮음)
  paperBorder: 64, // 편지지 테두리 장식 두께(px) — 글씨는 이 안쪽에만
  paperSlice: 20, // 그림 가장자리에서 테두리로 잘라 쓸 비율(%)
  kinds: {}, // { paper: { model, template }, … } 비면 기본
};

const astr = (v, max, d = '') => (typeof v === 'string' ? v.trim().slice(0, max) : d);
const asize = (v, d) => (typeof v === 'string' && /^\d{3,4}x\d{3,4}$/.test(v.trim()) ? v.trim() : d);
const anum = (v, lo, hi, d) => { const n = Number(v); return v !== '' && v !== null && v !== undefined && Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d; };

export function cleanArt(a) {
  const kinds = {};
  for (const k of ALL_KINDS) {
    const x = a?.kinds?.[k] || {};
    kinds[k] = { model: astr(x.model, 200), template: astr(x.template, 1500) };
  }
  return {
    connectionId: astr(a?.connectionId, 200),
    model: astr(a?.model, 200),
    style: astr(a?.style, 1500) || DEFAULT_STYLE,
    size: asize(a?.size, DEFAULT_ART.size),
    paperSize: asize(a?.paperSize, DEFAULT_ART.paperSize),
    perDay: anum(a?.perDay, 0, 100, DEFAULT_ART.perDay),
    autoItems: a?.autoItems === 'all' ? 'all' : 'off',
    sendNegative: !!a?.sendNegative,
    negative: astr(a?.negative, 1500) || NEGATIVE,
    paperStrength: anum(a?.paperStrength, 0, 100, DEFAULT_ART.paperStrength),
    paperBorder: anum(a?.paperBorder, 0, 200, DEFAULT_ART.paperBorder),
    paperSlice: anum(a?.paperSlice, 1, 45, DEFAULT_ART.paperSlice),
    kinds,
  };
}

export const templateFor = (art, kind) => art.kinds?.[kind]?.template || DEFAULT_TEMPLATES[kind] || DEFAULT_TEMPLATES.item;
export const modelFor = (art, kind) => art.kinds?.[kind]?.model || art.model || '';

// 하루 사용량(서버 날짜 기준 YYYY-MM-DD)
export function dayKey(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}
export function quotaLeft(usage, art, now = Date.now()) {
  const used = usage?.day === dayKey(now) ? usage.count || 0 : 0;
  return Math.max(0, art.perDay - used);
}
export function useQuota(usage, n, now = Date.now()) {
  const day = dayKey(now);
  const count = (usage?.day === day ? usage.count || 0 : 0) + n;
  return { day, count };
}

// 글 생성 1회로 그림 "주제"(영어 짧은 구)를 받는다. 구도·화풍은 템플릿이 맡는다.
export function buildArtPromptMessages(c, jobs) {
  const m = c.mail || {};
  const lines = jobs.map((j) => {
    if (j.kind === 'paper') return `- key=${j.key}: decorative motifs for the border of ${c.name}'s letter paper (their world's flora, tools, symbols; letter medium: ${m.medium || '-'}; texture: ${m.texture || '-'})`;
    if (j.kind === 'stamp') return `- key=${j.key}: the emblem shown on a postage stamp of that world (motif: ${m.stampMotif || '-'})`;
    if (j.kind === 'seal') return `- key=${j.key}: the design pressed into ${c.name}'s letter seal (seal: ${m.seal || '-'})`;
    return `- key=${j.key}: the object "${j.name}"${j.note ? ` (${j.note})` : ''} — its material, shape, wear and small details`;
  });
  const system = [
    'You write short English subject phrases for illustrations of objects and motifs from a fictional world.',
    'Describe only WHAT is shown: motifs, materials, colors, small details. 10-25 words each.',
    'Do not describe composition, camera, background, style or lighting (added later). Never include people, faces, hands, text, letters or numbers.',
  ].join('\n');
  const user = [
    `Correspondent: ${c.name}. Letter medium: ${m.medium || '-'}; scent: ${m.scent || '-'}.`,
    m.imageKeywords?.length ? `World keywords: ${m.imageKeywords.join(', ')}` : '',
    'Write one subject for each:',
    ...lines,
    'Output JSON only: {"prompts":[{"key":"","prompt":""}]}',
  ].filter(Boolean).join('\n');
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

export function cleanArtPrompts(raw, keys) {
  const list = Array.isArray(raw?.prompts) ? raw.prompts : [];
  const out = {};
  for (const p of list) {
    const k = astr(p?.key, 80);
    const t = astr(p?.prompt, 800);
    if (keys.includes(k) && t) out[k] = t;
  }
  return out;
}

// 템플릿에 주제·화풍을 넣어 최종 프롬프트
export function composePrompt(kind, subject, art) {
  const t = templateFor(art, kind);
  const withSubject = t.includes('{subject}') ? t.replaceAll('{subject}', subject) : `${subject}, ${t}`;
  return withSubject.includes('{style}') ? withSubject.replaceAll('{style}', art.style || DEFAULT_STYLE) : `${withSubject}, ${art.style || DEFAULT_STYLE}`;
}

// 요청 매개변수 시도 순서: 모델이 값을 거절하면(400) 하나씩 빼고 다시.
// 앱의 NanoGPT 연결은 negativePrompt를 보내지 않고, 연결에 저장된 rawRequestOverride가 크기를 덮어쓰므로 요청 덮어쓰기로 보낸다.
export function artParamAttempts(size, art) {
  const out = [];
  if (art.sendNegative) out.push({ size, rawRequestOverride: JSON.stringify({ size, negative_prompt: art.negative }) });
  out.push({ size, rawRequestOverride: JSON.stringify({ size }) });
  out.push({ size: '1024x1024', rawRequestOverride: '{}' });
  return out;
}
export const isParamRejection = (e) => /\(400\)|not support|unsupported|negative|resolution|size/i.test(String(e?.message || e));

// 상대 안의 그림 기록(없으면 빈 칸)
export function ensureArt(c) {
  if (c.art && typeof c.art === 'object') return c;
  return { ...c, art: {} };
}
