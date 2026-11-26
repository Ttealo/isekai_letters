// 이미지(소품 일러스트): 설정 정리, 그림 프롬프트 만들기, 하루 상한. 부수 효과 없음.
// 사람·얼굴·손·글자는 그리지 않는다. 편지지·우표·봉인은 상대마다 한 세트, 물건은 하나씩.

export const ART_KINDS = ['paper', 'stamp', 'seal'];
export const ART_LABEL = { paper: '편지지', stamp: '우표', seal: '봉인', item: '물건' };

export const DEFAULT_STYLE = 'delicate storybook illustration, soft watercolor and gouache, fine ink linework, gentle diffused light, muted pastel palette with one warm accent, paper grain texture, quiet still life, intimate and nostalgic mood';
export const NEGATIVE = 'photo, photograph, photorealistic, realistic, 3d render, people, person, face, hands, fingers, human figure, silhouette, text, letters, writing, words, numbers, digits, watermark, signature, logo';

// 앱의 NanoGPT 연결은 negativePrompt를 보내지 않고, 연결에 저장된 rawRequestOverride가 크기를 덮어쓴다.
// 그래서 우체통 그림은 요청 덮어쓰기로 크기·금지어를 직접 보낸다(이 요청에만 적용, 연결 설정은 그대로).
export function artParameters(size) {
  return { size, rawRequestOverride: JSON.stringify({ size, negative_prompt: NEGATIVE }) };
}

export const DEFAULT_ART = {
  connectionId: '', // 비면 앱 기본 이미지 연결
  model: '',
  style: DEFAULT_STYLE,
  size: '1024x1024',
  paperSize: '1024x1024',
  perDay: 6, // 하루 전체 장수(세트 포함)
  autoItems: 'off', // 'off' | 'all' — 상대가 보낸 물건을 도착할 때 자동으로 그리기
};

const astr = (v, max, d = '') => (typeof v === 'string' ? v.trim().slice(0, max) : d);
const asize = (v, d) => (typeof v === 'string' && /^\d{3,4}x\d{3,4}$/.test(v.trim()) ? v.trim() : d);

export function cleanArt(a) {
  const n = Number(a?.perDay);
  return {
    connectionId: astr(a?.connectionId, 200),
    model: astr(a?.model, 200),
    style: astr(a?.style, 1500) || DEFAULT_STYLE,
    size: asize(a?.size, DEFAULT_ART.size),
    paperSize: asize(a?.paperSize, DEFAULT_ART.paperSize),
    perDay: Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : DEFAULT_ART.perDay,
    autoItems: a?.autoItems === 'all' ? 'all' : 'off',
  };
}

// 하루 사용량(기기와 무관하게 서버 날짜 기준 YYYY-MM-DD)
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

// 글 생성 1회로 그림 주제(영어)를 받는다. jobs: [{key, kind, name?, note?}]
export function buildArtPromptMessages(c, jobs) {
  const m = c.mail || {};
  const lines = jobs.map((j) => {
    if (j.kind === 'paper') return `- key=${j.key}: a sheet of ${m.medium || 'letter paper'} from ${c.name}'s world, seen from above, empty center for writing, details only at the edges (texture: ${m.texture || '-'})`;
    if (j.kind === 'stamp') return `- key=${j.key}: a single postage stamp or postal mark of that world (motif: ${m.stampMotif || '-'})`;
    if (j.kind === 'seal') return `- key=${j.key}: the seal that closes ${c.name}'s letters, close-up (seal: ${m.seal || '-'})`;
    return `- key=${j.key}: the object "${j.name}"${j.note ? ` (${j.note})` : ''} as a small still life`;
  });
  const system = [
    'You write short English prompts for still-life illustrations of objects from a fictional world.',
    'Never include people, faces, hands, body parts, text, letters, numbers or logos in the scene.',
    'Describe material, color, light and a simple background. 25-50 words each. No style words (the style is added later).',
  ].join('\n');
  const user = [
    `World and correspondent (for context only): ${c.name}. Letter medium: ${m.medium || '-'}; scent: ${m.scent || '-'}.`,
    m.imageKeywords?.length ? `World keywords: ${m.imageKeywords.join(', ')}` : '',
    'Write one prompt for each:',
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

// 그림 주제 + 종류별 구도 + 화풍 → 최종 프롬프트
export function composePrompt(kind, subject, art) {
  const comp = {
    paper: 'top-down flat lay, the sheet fills most of the frame, plain empty center, decorative wear only along the edges',
    stamp: 'single postage stamp centered on a plain soft background, perforated edges, small emblem illustration inside',
    seal: 'macro close-up of a seal impression, centered, soft shallow depth of field',
    item: 'single object centered, small still life on a plain soft background',
  }[kind] || '';
  // 화풍을 맨 앞에(모델이 앞쪽 말을 더 따른다). 금지어는 negative_prompt로 따로 보낸다.
  return [`${art.style || DEFAULT_STYLE}, hand-painted illustration, not a photograph`, subject, comp, 'no people, blank unmarked surfaces without any writing or numbers'].filter(Boolean).join(', ');
}

// 상대 안의 그림 기록(없으면 빈 칸)
export function ensureArt(c) {
  if (c.art && typeof c.art === 'object') return c;
  return { ...c, art: {} };
}
