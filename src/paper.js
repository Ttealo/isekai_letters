// 편지지 꾸미기(그림 대신 HTML·SVG): 상대마다 테마(종이색·잉크·결·가장자리·글꼴·장식 무늬)를 정하고 화면·HTML 저장에 같이 쓴다. 부수 효과 없음.

export const PAPER_FONTS = {
  myeongjo: { family: 'Nanum Myeongjo', label: '나눔명조 (단정한 명조)', size: 1, google: 'Nanum+Myeongjo:wght@400;700' },
  gowun: { family: 'Gowun Batang', label: '고운바탕 (부드러운 바탕)', size: 1, google: 'Gowun+Batang:wght@400;700' },
  hahmlet: { family: 'Hahmlet', label: '함렡 (고전 활자)', size: 1, google: 'Hahmlet:wght@400;600' },
  songmyung: { family: 'Song Myung', label: '송명 (옛 인쇄체)', size: 1.02, google: 'Song+Myung' },
  pen: { family: 'Nanum Pen Script', label: '나눔손글씨 펜 (빠른 손글씨)', size: 1.32, google: 'Nanum+Pen+Script' },
  brush: { family: 'Nanum Brush Script', label: '나눔손글씨 붓 (굵은 붓)', size: 1.3, google: 'Nanum+Brush+Script' },
  gaegu: { family: 'Gaegu', label: '개구 (둥근 손글씨)', size: 1.12, google: 'Gaegu:wght@400;700' },
  dokdo: { family: 'East Sea Dokdo', label: '동해독도 (거친 손글씨)', size: 1.45, google: 'East+Sea+Dokdo' },
  himelody: { family: 'Hi Melody', label: '하이멜로디 (가벼운 손글씨)', size: 1.22, google: 'Hi+Melody' },
  poor: { family: 'Poor Story', label: '푸어스토리 (삐뚤한 손글씨)', size: 1.12, google: 'Poor+Story' },
  yeonsung: { family: 'Yeon Sung', label: '연성 (단단한 손글씨)', size: 1.15, google: 'Yeon+Sung' },
  gamja: { family: 'Gamja Flower', label: '감자꽃 (동글한 손글씨)', size: 1.2, google: 'Gamja+Flower' },
};
export const PAPER_FONT_URL = `https://fonts.googleapis.com/css2?${Object.values(PAPER_FONTS).map((f) => `family=${f.google}`).join('&')}&display=swap`;

// 24×24 선 무늬
export const PAPER_MOTIFS = {
  leaf: 'M4 20C4 10 10 4 20 4C20 14 14 20 4 20Z M4 20L14 10',
  star: 'M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.5 6.7 19.4l1.2-6L3.4 9.3l6-.7z',
  wave: 'M2 10c3-4 6-4 9 0s6 4 9 0 M2 16c3-4 6-4 9 0s6 4 9 0',
  gear: 'M12 8a4 4 0 1 0 .01 0 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2',
  snow: 'M12 2v20 M3.3 7l17.4 10 M3.3 17l17.4-10 M9 3.5l3 2 3-2 M9 20.5l3-2 3 2',
  vine: 'M2 16c5 0 6-8 10-8s5 8 10 8 M8 11c-1-3 1-5 3-5 M16 11c1-3-1-5-3-5',
  rune: 'M8 3v18 M8 4l8 6-8 6 M16 14v7',
  feather: 'M20 4C10 4 5 10 4 20 M20 4c0 8-6 13-14 14 M9 15l6-1 M11 11l6-1',
  scale: 'M2 12a5 5 0 0 1 10 0a5 5 0 0 1 10 0 M7 18a5 5 0 0 1 10 0',
  flower: 'M12 9a3 3 0 1 0 .01 0 M12 3c2 2 2 4 0 6c-2-2-2-4 0-6 M12 15c2 2 2 4 0 6c-2-2-2-4 0-6 M3 12c2-2 4-2 6 0c-2 2-4 2-6 0 M15 12c2-2 4-2 6 0c-2 2-4 2-6 0',
  moon: 'M15 3a9 9 0 1 0 6 13a7 7 0 1 1-6-13Z',
  shell: 'M12 20L3 9c3-4 15-4 18 0Z M12 20L8 7 M12 20V6 M12 20l4-13',
  flame: 'M12 21c-4 0-6-3-6-6 0-4 4-6 4-10 3 2 4 5 4 7 1-1 2-2 2-4 2 2 2 4 2 7 0 3-2 6-6 6Z',
  key: 'M7 9a3 3 0 1 0 .01 0 M10 12h11 M17 12v3 M20 12v2',
};
export const PAPER_MOTIF_LABEL = {
  leaf: '잎', star: '별', wave: '물결', gear: '톱니바퀴', snow: '눈꽃', vine: '덩굴', rune: '룬 문자', feather: '깃털',
  scale: '비늘', flower: '꽃', moon: '달', shell: '조개', flame: '불꽃', key: '열쇠',
};
export const PAPER_TEXTURES = { lined: '줄', grid: '모눈', parchment: '양피지 얼룩', fiber: '섬유 결', dots: '점', plain: '민무늬' };
export const PAPER_EDGES = { straight: '곧은 가장자리', deckle: '손으로 뜬 종이(울퉁불퉁)', torn: '찢어 낸 가장자리', stitched: '바느질 테두리' };

const hexOk = (v) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim().toLowerCase() : '');
const lum = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => { const s = x / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
};
export const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const PALETTES = [
  ['#f4ead6', '#3b2f22', '#8a5a2b'], ['#eef1e6', '#24331f', '#5f7d3a'], ['#f3ede4', '#2d2a3a', '#6b4e8a'], ['#e9eef3', '#1f2e3d', '#3d6c8f'],
  ['#f6e9e4', '#3a2420', '#a0473b'], ['#efe6cf', '#2f2a1d', '#8b7330'], ['#2a2630', '#ece2cf', '#c9a45a'], ['#f2f0ea', '#262626', '#7a7a7a'],
];
const hashStr = (s) => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

// 글 생성 전에도 보기 좋게: 상대 id로 고정된 기본 테마
export function defaultTheme(c) {
  const h = hashStr(c?.id || c?.name || 'x');
  const pal = PALETTES[h % PALETTES.length];
  const pick = (obj, k) => Object.keys(obj)[(h >>> k) % Object.keys(obj).length];
  return { paper: pal[0], ink: pal[1], accent: pal[2], texture: pick(PAPER_TEXTURES, 3), edge: pick(PAPER_EDGES, 7), font: pick(PAPER_FONTS, 11), motif: pick(PAPER_MOTIFS, 15), density: 2, note: '', auto: true };
}

export function cleanTheme(t, fallback = null) {
  const f = fallback || defaultTheme({});
  const paper = hexOk(t?.paper) || f.paper;
  let ink = hexOk(t?.ink) || f.ink;
  if (contrast(paper, ink) < 4.5) ink = lum(paper) > 0.4 ? '#2b2420' : '#f1e9da'; // 글씨가 안 읽히면 바꿈
  const accent = hexOk(t?.accent) || f.accent;
  const one = (v, obj, d) => (typeof v === 'string' && Object.hasOwn(obj, v) ? v : d);
  const dn = Math.round(Number(t?.density));
  return {
    paper, ink, accent,
    texture: one(t?.texture, PAPER_TEXTURES, f.texture),
    edge: one(t?.edge, PAPER_EDGES, f.edge),
    font: one(t?.font, PAPER_FONTS, f.font),
    motif: one(t?.motif, PAPER_MOTIFS, f.motif),
    density: Number.isFinite(dn) ? Math.min(3, Math.max(1, dn)) : 2,
    note: typeof t?.note === 'string' ? t.note.trim().slice(0, 200) : '',
    ...(t?.auto ? { auto: true } : {}),
  };
}

// 글 생성 1회로 테마를 고른다(사건이 있으면 이전 테마에서 조금 바꿈)
export function buildThemeMessages(c, { reason = '', prev = null } = {}) {
  const m = c.mail || {};
  const system = [
    'You design the stationery of a correspondent from another world, as data for an HTML letter page (no image).',
    'Pick values that fit their world, letter medium and personality. Colors are hex; ink must be easy to read on paper.',
    `font (handwriting/typeface of their letters): ${Object.entries(PAPER_FONTS).map(([k, v]) => `${k}=${v.label}`).join(', ')}`,
    `texture: ${Object.keys(PAPER_TEXTURES).join(' / ')}; edge: ${Object.keys(PAPER_EDGES).join(' / ')}`,
    `motif (border ornament): ${Object.keys(PAPER_MOTIFS).join(' / ')}; density 1 (sparse) ~ 3 (rich)`,
    'note: one short Korean phrase describing the stationery.',
  ].join('\n');
  const user = [
    `<correspondent name="${c.name}">`,
    String(c.brief || '').slice(0, 1500),
    '</correspondent>',
    `letter medium=${m.medium || '-'}; texture=${m.texture || '-'}; scent=${m.scent || '-'}; seal=${m.seal || '-'}`,
    m.imageKeywords?.length ? `world keywords=${m.imageKeywords.join(', ')}` : '',
    prev ? `current stationery=${JSON.stringify(prev)}` : '',
    reason ? `Something happened, so this letter's stationery changes: ${reason}. Change only what the event would change (1~3 values).` : '',
    'Output JSON only: {"paper":"#","ink":"#","accent":"#","texture":"","edge":"","font":"","motif":"","density":2,"note":""}',
  ].filter(Boolean).join('\n');
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

// ── 그리기(화면·HTML 저장 공용): 스타일 글과 SVG 문자열 ──
const enc = (svg) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
const motifSvg = (t, size, opacity) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="-6 -6 36 36"><path d="${PAPER_MOTIFS[t.motif]}" fill="none" stroke="${t.accent}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}"/></svg>`;
const TEXTURE_CSS = (t) => ({
  lined: `repeating-linear-gradient(transparent 0 27px, ${t.ink}22 27px 28px, transparent 28px 30px)`,
  grid: `repeating-linear-gradient(transparent 0 23px, ${t.ink}1a 23px 24px), repeating-linear-gradient(90deg, transparent 0 23px, ${t.ink}1a 23px 24px)`,
  parchment: `radial-gradient(circle at 18% 22%, ${t.ink}12, transparent 38%), radial-gradient(circle at 82% 68%, ${t.ink}10, transparent 42%), radial-gradient(circle at 55% 95%, ${t.accent}14, transparent 35%)`,
  fiber: `repeating-linear-gradient(37deg, transparent 0 3px, ${t.ink}08 3px 4px), repeating-linear-gradient(-53deg, transparent 0 5px, ${t.ink}06 5px 6px)`,
  dots: `radial-gradient(${t.ink}26 1px, transparent 1.3px) 0 0 / 18px 18px`,
  plain: 'none',
}[t.texture]);
// 가장자리: 정해진 씨앗으로 울퉁불퉁한 다각형(매번 같은 모양)
function edgePath(t, seed) {
  if (t.edge !== 'deckle' && t.edge !== 'torn') return '';
  let s = hashStr(seed) || 1;
  const r = () => { s = (s * 1103515245 + 12345) >>> 0; return (s % 1000) / 1000; };
  const amp = t.edge === 'torn' ? 1.4 : 0.6;
  const pts = [];
  const N = 28;
  for (let i = 0; i <= N; i++) pts.push(`${(i / N) * 100}% ${(r() * amp).toFixed(2)}%`);
  for (let i = 1; i <= N; i++) pts.push(`${100 - (r() * amp * 0.6).toFixed(2)}% ${(i / N) * 100}%`);
  for (let i = N - 1; i >= 0; i--) pts.push(`${(i / N) * 100}% ${(100 - r() * amp).toFixed(2)}%`);
  for (let i = N - 1; i >= 1; i--) pts.push(`${(r() * amp * 0.6).toFixed(2)}% ${(i / N) * 100}%`);
  return `polygon(${pts.join(',')})`;
}
export function paperLook(theme, { seed = '', narrow = false } = {}) {
  const t = cleanTheme(theme);
  const f = PAPER_FONTS[t.font];
  const band = narrow ? 18 : [0, 20, 28, 36][t.density];
  const tile = [0, 40, 30, 24][t.density];
  const clip = edgePath(t, seed);
  const outer = [
    `background:${t.paper} ${enc(motifSvg(t, tile, 0.55))} repeat`,
    `background-size:${tile}px ${tile}px`,
    `padding:${band}px`,
    'position:relative',
    clip ? `clip-path:${clip}` : '',
    t.edge === 'stitched' ? `outline:2px dashed ${t.accent}99;outline-offset:-7px` : '',
    `box-shadow:0 10px 22px -12px #0008`,
    'margin:4px 0 14px',
  ].filter(Boolean).join(';');
  const inner = [
    `background-color:${t.paper}`,
    `background-image:${TEXTURE_CSS(t)}`,
    `color:${t.ink}`,
    `font-family:"${f.family}","Nanum Myeongjo","Noto Serif KR",Georgia,serif`,
    `font-size:${(14.5 * f.size).toFixed(1)}px`,
    // 줄·모눈 종이는 글줄을 줄 간격(30px·24px)에 맞춘다
    t.texture === 'lined' ? 'line-height:30px' : t.texture === 'grid' ? 'line-height:24px' : `line-height:${f.size > 1.1 ? 1.75 : 1.95}`,
    `border:1px solid ${t.accent}55`,
    `padding:${narrow ? '14px 12px' : '22px 24px 18px'}`,
    'white-space:pre-wrap',
    'position:relative',
  ].join(';');
  const corner = (rot) => `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="-6 -6 36 36" style="position:absolute;${rot}"><path d="${PAPER_MOTIFS[t.motif]}" fill="${t.accent}22" stroke="${t.accent}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const corners = narrow ? '' : [corner('top:4px;left:4px'), corner('top:4px;right:4px;transform:scaleX(-1)'), corner('bottom:4px;left:4px;transform:scaleY(-1)'), corner('bottom:4px;right:4px;transform:scale(-1,-1)')].join('');
  return { theme: t, outer, inner, corners, metaColor: `${t.ink}aa`, accent: t.accent };
}
