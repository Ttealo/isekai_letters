import { etaLabel, formatSpan } from './core.js';

// 이세계 우체통 프런트
// 1) 서랍 탭: 페르소나별 상대 목록, 새 상대·수정, 편지 쓰기, 설정
// 2) 우체통 위젯(플로트, ui_panels): 새 편지면 깃발과 숫자. 누르면 보조창을 열고 닫음
// 3) 보조창(오른쪽 도크, ui_panels): 페르소나 → 상대 → 편지첩 / 물품 / 모음
// 모든 글은 textContent로만 넣는다(생성된 글에 HTML이 섞여도 실행되지 않게).

const CSS = `
.im-tab,.im-panel{display:flex;flex-direction:column;gap:12px;padding:12px;color:var(--lumiverse-text);font-size:13px;line-height:1.6;box-sizing:border-box}
.im-panel{height:100%;overflow:auto;padding:12px 14px 20px}
.im-tab h3,.im-panel h3{margin:0;font-size:15px}
.im-tab h4,.im-panel h4{margin:4px 0 0;font-size:13px}
.im-muted{color:var(--lumiverse-text-muted);font-size:12px}
.im-err{color:var(--lumiverse-danger);font-size:12px}
.im-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.im-grow{flex:1;min-width:0}
.im-tab textarea,.im-tab input,.im-tab select,.im-panel textarea,.im-panel input,.im-panel select{width:100%;box-sizing:border-box;background:var(--lumiverse-fill);color:var(--lumiverse-text);border:1px solid var(--lumiverse-border);border-radius:var(--lumiverse-radius,6px);padding:6px 8px;font:inherit}
.im-tab textarea,.im-panel textarea{min-height:90px;resize:vertical}
.im-tab label,.im-panel label{display:flex;flex-direction:column;gap:3px;font-size:12px;color:var(--lumiverse-text-muted)}
.im-pair{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.im-btn{background:var(--lumiverse-fill);color:var(--lumiverse-text);border:1px solid var(--lumiverse-border);border-radius:var(--lumiverse-radius,6px);padding:5px 12px;cursor:pointer;font:inherit}
.im-btn.im-primary{background:var(--lumiverse-primary);color:#fff;border-color:transparent}
.im-btn:disabled{opacity:.5;cursor:default}
.im-link{background:none;border:none;color:var(--lumiverse-primary);cursor:pointer;padding:0;font:inherit}
.im-card{border:1px solid var(--lumiverse-border);border-radius:var(--lumiverse-radius,8px);padding:10px 12px;background:var(--lumiverse-fill-subtle,transparent);cursor:pointer;display:flex;flex-direction:column;gap:2px}
.im-card:hover{border-color:var(--lumiverse-primary)}
.im-badge{display:inline-block;min-width:18px;padding:0 6px;border-radius:9px;background:var(--lumiverse-primary);color:#fff;font-size:11px;text-align:center}
.im-letter{border:1px solid var(--lumiverse-border);border-radius:var(--lumiverse-radius,8px);padding:10px 12px;display:flex;flex-direction:column;gap:4px}
.im-letter.im-mine{margin-left:18px}
.im-letter.im-theirs{margin-right:18px;cursor:pointer}
.im-chips{display:flex;gap:6px;flex-wrap:wrap}
.im-chip{display:inline-flex;align-items:center;gap:6px;padding:3px 10px 3px 4px;border:1px solid var(--lumiverse-border);border-radius:999px;background:var(--lumiverse-fill);color:var(--lumiverse-text);cursor:pointer;font:inherit;font-size:12px}
.im-chip.im-on{border-color:var(--lumiverse-primary);box-shadow:0 0 0 1px var(--lumiverse-primary) inset}
.im-chip.im-plain{padding:3px 10px}
.im-ava{width:22px;height:22px;border-radius:50%;object-fit:cover;background:var(--lumiverse-fill-subtle,#8884);display:inline-flex;align-items:center;justify-content:center;font-size:11px;flex:none}
.im-tabs{display:flex;gap:2px;border-bottom:1px solid var(--lumiverse-border)}
.im-tabs button{background:none;border:none;border-bottom:2px solid transparent;color:var(--lumiverse-text-muted);padding:6px 12px;cursor:pointer;font:inherit}
.im-tabs button.im-on{color:var(--lumiverse-text);border-bottom-color:var(--lumiverse-primary)}
.im-paper{position:relative;font-family:"Nanum Myeongjo","Noto Serif KR","Batang",Georgia,serif;white-space:pre-wrap;font-size:14.5px;line-height:1.9;padding:18px 20px 16px;border-radius:4px;color:#3b2f22;background:#f4ead6;background-image:repeating-linear-gradient(transparent 0 27px,#d9c7a455 27px 28px);border:1px solid #d6c3a0;box-shadow:0 1px 0 #c9b38c,0 6px 14px -8px #0006}
.im-paper.im-has-paper{border-color:#cbb48a}
.im-paper.im-mine{color:#26313b;background:#eef1f4;background-image:repeating-linear-gradient(transparent 0 27px,#b8c4d055 27px 28px);border-color:#c5ced8;box-shadow:0 1px 0 #b8c2cc,0 6px 14px -8px #0005;margin-left:22px}
.im-paper.im-theirs{margin-right:22px}
.im-paper .im-meta{font-family:system-ui,sans-serif;font-size:11px;color:#7a6a52;white-space:normal;margin:0 54px 8px 0;line-height:1.5}
.im-paper.im-mine .im-meta{color:#5d6b78;margin-right:0}
.im-stamp{position:absolute;right:12px;top:12px;width:38px;height:46px;border:2px dashed #b08a5a;border-radius:3px;display:flex;align-items:center;justify-content:center;text-align:center;font-family:system-ui,sans-serif;font-size:9px;line-height:1.2;color:#8a6a40;padding:2px;box-sizing:border-box;overflow:hidden;background:#efe2c6}
.im-stamp img{width:100%;height:100%;object-fit:cover}
.im-encl{font-family:system-ui,sans-serif;white-space:normal;margin-top:10px;padding-top:8px;border-top:1px dashed #c9b38c;font-size:12px;color:#6b5a40}
.im-paper.im-mine .im-encl{border-color:#b8c2cc;color:#55626e}
.im-envelope{display:flex;flex-direction:column;gap:6px;padding:16px;border-radius:6px;border:1px solid #cdb68e;background:#e9d9b8;color:#3b2f22;margin-right:22px;position:relative}
.im-envelope dt{font-size:11px;color:#7a6a52}
.im-envelope dd{margin:0 0 4px}
.im-envelope .im-btn{align-self:flex-start;background:#8a5a2b;color:#fff;border-color:transparent}
.im-transit{border:1px dashed var(--lumiverse-border);border-radius:6px;padding:8px 12px;color:var(--lumiverse-text-muted);font-size:12px}
.im-transit.im-mine{margin-left:22px;text-align:right}
.im-transit.im-theirs{margin-right:22px}
.im-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(118px,1fr));gap:10px}
.im-item{border:1px solid var(--lumiverse-border);border-radius:8px;overflow:hidden;background:var(--lumiverse-fill-subtle,transparent);display:flex;flex-direction:column}
.im-item .im-pic{aspect-ratio:1/1;background:#efe2c6;display:flex;align-items:center;justify-content:center;color:#a88a5e}
.im-item .im-pic img{width:100%;height:100%;object-fit:cover}
.im-item .im-pic{position:relative}
.im-state{position:absolute;left:0;right:0;bottom:0;padding:4px 6px;font-size:11px;line-height:1.35;text-align:center;color:#fff;background:rgba(40,30,20,.72)}
.im-state.im-bad{background:rgba(150,40,30,.85)}
.im-spin{display:inline-block;width:9px;height:9px;margin-right:5px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:im-spin 1s linear infinite;vertical-align:-1px}
@keyframes im-spin{to{transform:rotate(360deg)}}
.im-pill{position:absolute;left:-6px;top:58px;padding:1px 6px;border-radius:9px;font:600 10px/16px system-ui,sans-serif;color:#fff;white-space:nowrap}
.im-item .im-cap{padding:6px 8px;font-size:12px;line-height:1.4}
.im-item .im-cap b{display:block;font-size:12.5px}
.im-bundle{display:flex;gap:10px;align-items:center;border:1px solid var(--lumiverse-border);border-radius:8px;padding:10px;cursor:pointer;background:var(--lumiverse-fill-subtle,transparent)}
.im-bundle:hover{border-color:var(--lumiverse-primary)}
.im-bundle .im-stack{width:44px;height:36px;position:relative;flex:none}
.im-bundle .im-stack i{position:absolute;inset:0;border:1px solid #cdb68e;background:#f4ead6;border-radius:2px}
.im-bundle .im-stack i:nth-child(1){transform:rotate(-8deg)}
.im-bundle .im-stack i:nth-child(2){transform:rotate(5deg)}
.im-sep{border:none;border-top:1px solid var(--lumiverse-border);margin:4px 0}
.im-page{position:fixed;inset:0;z-index:40;display:flex;flex-direction:column;background:var(--lumiverse-bg,var(--lumiverse-fill));color:var(--lumiverse-text)}
.im-page-head{display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid var(--lumiverse-border);background:var(--lumiverse-fill)}
.im-page-head b{font-size:15px}
.im-page-body{flex:1;min-height:0;display:flex}
.im-page-list{width:280px;flex:none;border-right:1px solid var(--lumiverse-border);overflow:auto;padding:12px;display:flex;flex-direction:column;gap:8px;box-sizing:border-box}
.im-page-main{flex:1;min-width:0;overflow:auto}
.im-page-main .im-panel{max-width:760px;margin:0 auto;height:auto;overflow:visible;padding:16px 20px 40px}
.im-row-card{border:1px solid var(--lumiverse-border);border-radius:8px;padding:8px 10px;cursor:pointer;display:flex;flex-direction:column;gap:2px;background:var(--lumiverse-fill-subtle,transparent)}
.im-row-card.im-on{border-color:var(--lumiverse-primary);box-shadow:0 0 0 1px var(--lumiverse-primary) inset}
.im-page-chips{display:none;flex-direction:column;gap:8px}
@media (max-width:760px){.im-page-list{display:none}.im-page-main .im-panel{padding:12px}.im-page-chips{display:flex}}
.im-box{cursor:pointer;user-select:none;width:76px;height:96px;display:block}
.im-box svg{display:block;filter:drop-shadow(0 3px 4px #0005)}
.im-note{position:absolute;right:0;bottom:100%;margin-bottom:6px;white-space:nowrap;background:var(--lumiverse-fill);color:var(--lumiverse-text);border:1px solid var(--lumiverse-border);border-radius:6px;padding:4px 8px;font-size:11px;pointer-events:none}
`;
const ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 8l9 6 9-6"/><path d="M15 3.5l2 1.2"/></svg>';
const PIC = '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l2.5 5 5.5.8-4 3.9.9 5.5L12 15.6 7.1 18.2 8 12.7 4 8.8l5.5-.8z"/></svg>';
const NO_PERSONA = '__none__';
const ALL = '__all__';
const LS_PERSONA = 'isekai_mailbox.persona';
const LS_PANEL = 'isekai_mailbox.panel';
const LS_PANEL_MODE = 'isekai_mailbox.panelMode';

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v; // 우리 코드의 고정 SVG에만 쓴다
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    // 읽기 전용 속성(style·list·form 등)은 속성으로. 그 밖에도 지정이 실패하면 속성으로 넘긴다
    else if (k === 'style' || k === 'list' || k === 'form') node.setAttribute(k, v);
    else if (k in node) { try { node[k] = v; } catch { node.setAttribute(k, v); } }
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c !== null && c !== undefined && c !== false) node.append(c);
  return node;
}
const btn = (text, onclick, opts = {}) => el('button', { class: `im-btn${opts.primary ? ' im-primary' : ''}`, type: 'button', text, disabled: !!opts.disabled, onclick });
const link = (text, onclick) => el('button', { class: 'im-link', type: 'button', text, onclick });
const field = (label, input) => el('label', {}, [label, input]);
const when = (ms) => new Date(ms).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const imgUrl = (id, size = 'sm') => `/api/v1/images/${encodeURIComponent(id)}?size=${size}`;
const lsGet = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const short = (t, n) => (t.length > n ? `${t.slice(0, n)}…` : t);

// 배송 시간을 실제(가속 반영) 시간으로
function deliveryLabel(c) {
  const s = Math.max(1, Number(c.timeScale) || 1);
  const f = (h) => (s > 1 ? formatSpan(h / s) : `${h}시간`);
  const range = c.delivery.min === c.delivery.max ? f(c.delivery.min) : `${f(c.delivery.min)}~${f(c.delivery.max)}`;
  return `배송 ${range}${s > 1 ? ` (시험 가속 ${s}배)` : ''}`;
}

export function setup(ctx) {
  // ── 백엔드 요청 ──
  const waits = new Map();
  let seq = 0;
  const offBack = ctx.onBackendMessage((msg) => {
    if (msg?.type === 'changed' && !msg.requestId) { refreshSoon(); return; }
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

  // ── 공용 상태 ──
  const S = {
    list: [], all: [], settings: null, personas: [], activePersonaId: '',
    persona: lsGet(LS_PERSONA, ALL), // 보고 있는 페르소나(서랍·보조창 공유)
    error: '',
  };
  const views = new Set(); // 다시 그릴 화면들
  const renderAll = () => { for (const v of views) v.render(); };
  const byId = (id) => S.all.find((c) => c.id === id) || null;
  const personaOf = (id) => S.personas.find((p) => p.id === id) || null;
  const inPersona = (x) => S.persona === ALL || (S.persona === NO_PERSONA ? !x.personaId : x.personaId === S.persona);
  const setPersona = (id) => { S.persona = id; lsSet(LS_PERSONA, id); renderAll(); };

  async function refresh() {
    try {
      const [r, p] = await Promise.all([ask('all'), S.personas.length ? null : ask('personas').catch(() => null)]);
      S.all = r.all;
      S.settings = r.settings;
      if (p) { S.personas = p.personas; S.activePersonaId = p.activeId; }
      const l = await ask('load');
      S.list = l.list;
      S.error = '';
      ask('artStatus').then((a) => { S.art = a; }).catch(() => {});
      convertWebp();
    } catch (e) { S.error = e.message || String(e); }
    const unread = S.list.reduce((n, x) => n + x.unread, 0);
    tab.setBadge(unread ? String(unread) : null);
    renderAll();
  }
  // 백엔드가 만든 png를 이 브라우저에서 WebP로 바꿔 돌려준다(백엔드에는 변환 도구가 없음)
  let converting = false;
  async function toWebp(blob) {
    const bmp = await createImageBitmap(blob);
    const MAX = 1280;
    const k = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
    const W = Math.round(bmp.width * k);
    const H = Math.round(bmp.height * k);
    let out;
    if (typeof OffscreenCanvas !== 'undefined') {
      const cv = new OffscreenCanvas(W, H);
      cv.getContext('2d').drawImage(bmp, 0, 0, W, H);
      out = await cv.convertToBlob({ type: 'image/webp', quality: 0.85 });
    } else {
      const cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      cv.getContext('2d').drawImage(bmp, 0, 0, W, H);
      out = await new Promise((res) => cv.toBlob(res, 'image/webp', 0.85));
    }
    bmp.close?.();
    if (!out || out.type !== 'image/webp') throw new Error('이 브라우저는 WebP로 저장하지 못합니다.');
    return out;
  }
  const b64 = async (blob) => {
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return btoa(bin);
  };
  async function convertWebp() {
    if (converting || typeof createImageBitmap !== 'function') return;
    converting = true;
    try {
      const { queue } = await ask('webpQueue');
      for (const row of queue || []) {
        try {
          const r = await fetch(`/api/v1/images/${encodeURIComponent(row.imageId)}`, { credentials: 'include' });
          if (!r.ok) throw new Error(`원본을 못 받음(${r.status})`);
          const src = await r.blob();
          const webp = await toWebp(src);
          await ask('webpDone', { imageId: row.imageId, data: await b64(webp), originalBytes: src.size }, 60000);
        } catch (e) {
          await ask('webpFail', { imageId: row.imageId, error: String(e?.message || e) }).catch(() => {});
        }
      }
    } catch {} finally { converting = false; }
  }
  let soon = null;
  const refreshSoon = () => { clearTimeout(soon); soon = setTimeout(refresh, 300); };
  const reloadPersonas = async () => { try { const p = await ask('personas'); S.personas = p.personas; S.activePersonaId = p.activeId; } catch {} };

  // 페르소나 고르기 줄(서랍·보조창 공용)
  function personaChips() {
    const used = new Set(S.list.map((x) => x.personaId || NO_PERSONA));
    const chips = [el('button', { class: `im-chip im-plain${S.persona === ALL ? ' im-on' : ''}`, type: 'button', text: '모두', onclick: () => setPersona(ALL) })];
    for (const p of S.personas) {
      const count = S.list.filter((x) => x.personaId === p.id).length;
      if (!count && p.id !== S.persona) continue; // 편지 상대가 있는 페르소나만(고른 것은 유지)
      chips.push(el('button', { class: `im-chip${S.persona === p.id ? ' im-on' : ''}`, type: 'button', title: p.title || p.name, onclick: () => setPersona(p.id) }, [
        p.imageId ? el('img', { class: 'im-ava', src: imgUrl(p.imageId), alt: '' }) : el('span', { class: 'im-ava', text: p.name.slice(0, 1) }),
        `${p.name} · ${count}`,
      ]));
    }
    if (used.has(NO_PERSONA)) chips.push(el('button', { class: `im-chip im-plain${S.persona === NO_PERSONA ? ' im-on' : ''}`, type: 'button', text: '페르소나 없음', onclick: () => setPersona(NO_PERSONA) }));
    return el('div', { class: 'im-chips' }, chips);
  }

  // 편지 쓰기 칸(서랍·보조창 공용)
  const drafts = new Map(); // 상대 id → { body, enclosure }
  function composeBox(c, { busyRef, act, onSent }) {
    const d = drafts.get(c.id) || { body: '', enclosure: '' };
    drafts.set(c.id, d);
    const sender = c.personaId ? (personaOf(c.personaId)?.name || c.personaName || '(지워진 페르소나)') : '활성 페르소나';
    return el('div', { class: 'im-letter' }, [
      el('div', { class: 'im-row' }, [el('h4', { class: 'im-grow', text: `${c.name}에게` }), el('span', { class: 'im-muted', text: `보내는 사람: ${sender}` })]),
      el('textarea', { value: d.body, placeholder: '편지 본문', rows: 7, oninput: (e) => { d.body = e.target.value; } }),
      el('textarea', { value: d.enclosure, placeholder: '동봉할 것(선택, 한 줄에 하나) — 예: 말린 네잎클로버 한 장', rows: 2, style: 'min-height:48px', oninput: (e) => { d.enclosure = e.target.value; } }),
      el('div', { class: 'im-row' }, [
        el('span', { class: 'im-muted im-grow', text: `${deliveryLabel(c)}. 도착 전에는 회수할 수 있습니다.` }),
        btn(busyRef() ? '보내는 중…' : '보내기', () => act(async () => {
          if (!d.body.trim()) throw new Error('본문을 적어 주세요.');
          await ask('send', { id: c.id, body: d.body, enclosure: d.enclosure });
          drafts.set(c.id, { body: '', enclosure: '' });
          await refresh();
          onSent?.();
        }), { primary: true, disabled: busyRef() }),
      ]),
    ]);
  }

  // ══════════════ 서랍 탭 ══════════════
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

  const drawer = (() => {
    let view = { name: 'home' };
    let busy = false;
    let error = '';
    let connections = null;
    let imageConns = null;
    const modelCache = {};
    const go = (v) => { view = v; error = ''; render(); if (v.name === 'home' || v.name === 'c') refresh(); };
    const act = async (fn) => {
      if (busy) return;
      busy = true; error = ''; render();
      try { await fn(); } catch (e) { error = e.message || String(e); }
      busy = false; render();
    };

    function render() {
      const body = { home: homeView, c: cView, letter: letterView, form: formView, settings: settingsView, match: matchView, preview: previewView, dossier: dossierView }[view.name]?.() || [];
      const err = error || S.error;
      root.replaceChildren(...[].concat(body, err ? el('div', { class: 'im-err', text: err }) : null).filter(Boolean));
    }

    function homeView() {
      const shown = S.list.filter(inPersona);
      return [
        el('div', { class: 'im-row' }, [
          el('h3', { class: 'im-grow', text: '우편함' }),
          btn('새 상대', async () => { await reloadPersonas(); go({ name: 'match' }); }, { primary: true }),
          btn('설정', () => go({ name: 'settings' })),
        ]),
        S.list.length ? personaChips() : null,
        panel ? link(panel.isCollapsed() ? '보조창(편지첩) 열기' : '보조창 닫기', () => togglePanel()) : el('div', { class: 'im-muted', text: '우체통 위젯과 보조창은 확장 패널에서 ui_panels 권한을 승인하면 나타납니다.' }),
        S.list.length ? null : el('div', { class: 'im-muted', text: '아직 편지를 주고받는 상대가 없습니다. 「새 상대」에서 누구에게 편지를 보낼지 적어 주세요.' }),
        ...shown.map((x) => el('div', { class: 'im-card', onclick: () => go({ name: 'c', id: x.id }) }, [
          el('div', { class: 'im-row' }, [
            el('b', { class: 'im-grow', text: x.name }),
            x.unread ? el('span', { class: 'im-badge', text: String(x.unread) }) : null,
          ]),
          el('div', { class: 'im-muted', text: `${x.personaName ? `${x.personaName}의 상대 · ` : ''}그쪽은 지금 ${x.theirNow} · 시간 1:${x.ratio}` }),
          el('div', { class: x.failed ? 'im-err' : 'im-muted', text: x.status }),
        ])),
      ];
    }

    function cView() {
      const c = byId(view.id);
      if (!c) return [link('← 우편함', () => go({ name: 'home' })), el('div', { class: 'im-muted', text: '불러오는 중…' })];
      const now = Date.now();
      const exact = !!S.settings?.showExactEta;
      const s = S.list.find((x) => x.id === c.id);
      const items = c.letters.slice().reverse().map((l) => {
        if (l.from === 'me') {
          return el('div', { class: 'im-letter im-mine' }, [
            el('div', { class: 'im-muted', text: `보낸 편지 · ${when(l.sentAt)} · 그쪽 ${l.theirSentLabel}` }),
            el('div', { text: short(l.body, 140) }),
            l.state === 'in_transit'
              ? el('div', { class: 'im-row' }, [el('span', { class: 'im-muted im-grow', text: etaLabel(l.arriveAt - now, exact) }), link('회수하기', () => act(async () => {
                if (!confirm('이 편지를 회수할까요? 상대에게 가지 않습니다.')) return;
                await ask('recall', { id: c.id, letterId: l.id });
                await refresh();
              }))])
              : el('div', { class: 'im-muted', text: `도착함 · 그쪽 ${l.theirArriveLabel}` }),
          ]);
        }
        if (l.state === 'in_transit') {
          return el('div', { class: 'im-letter' }, [
            el('div', { class: 'im-muted', text: `${c.name}의 편지가 오는 중` }),
            el('div', { text: exact ? etaLabel(l.arriveAt - now, true) : '어딘가를 건너는 중…' }),
          ]);
        }
        return el('div', { class: 'im-letter im-theirs', onclick: () => { view = { name: 'letter', id: c.id, letterId: l.id }; render(); } }, [
          el('div', { class: 'im-row' }, [
            el('b', { class: 'im-grow', text: l.state === 'delivered' ? '새 편지' : `${c.name}의 편지` }),
            l.state === 'delivered' ? el('span', { class: 'im-badge', text: '!' }) : null,
          ]),
          el('div', { class: 'im-muted', text: `도착 ${when(l.arriveAt)} · 그쪽 ${l.theirWrittenLabel}에 씀` }),
          l.state === 'opened' ? el('div', { text: short(l.body, 100) }) : el('div', { class: 'im-muted', text: l.envelope?.medium ? `봉투: ${l.envelope.medium}` : '봉투가 닫혀 있습니다' }),
        ]);
      });
      return [
        el('div', { class: 'im-row' }, [link('← 우편함', () => go({ name: 'home' })), el('span', { class: 'im-grow' }), panel ? link('편지첩으로 보기', () => openPanelFor(c.id)) : null, link('서류함', () => openDossier(c.id)), link('상대 정보 수정', async () => { await reloadPersonas(); go({ name: 'form', id: c.id }); })]),
        el('h3', { text: c.name }),
        el('div', { class: 'im-muted', text: `그쪽은 지금 ${c.theirNowLabel} · 시간 1:${c.ratio} (나의 하루 = 그쪽 ${formatSpan(24 * c.ratio)})` }),
        s ? el('div', { class: s.failed ? 'im-err' : 'im-muted', text: s.status }) : null,
        c.reply?.state === 'failed' ? el('div', { class: 'im-row' }, [
          el('span', { class: 'im-err im-grow', text: `사유: ${c.reply.error || '알 수 없음'}` }),
          btn('다시 시도', () => act(async () => { await ask('retry', { id: c.id }); await refresh(); })),
        ]) : null,
        composeBox(c, { busyRef: () => busy, act }),
        el('hr', { class: 'im-sep' }),
        ...(items.length ? items : [el('div', { class: 'im-muted', text: '아직 주고받은 편지가 없습니다.' })]),
      ];
    }

    function letterView() {
      const c = byId(view.id);
      const l = c?.letters.find((x) => x.id === view.letterId);
      if (!l) return [link('← 돌아가기', () => go({ name: 'c', id: view.id }))];
      return [
        el('div', { class: 'im-row' }, [link(`← ${c.name}`, () => go({ name: 'c', id: c.id }))]),
        theirLetterNode(c, l, { act }),
      ];
    }

    // 새 상대 / 수정
    function formView() {
      const editing = !!view.id;
      const cur = editing ? byId(view.id) : null;
      const v = cur ? {
        name: cur.name, brief: cur.brief, world: cur.world, ratio: cur.ratio, deliveryMin: cur.delivery.min, deliveryMax: cur.delivery.max,
        writeMin: cur.writeDelay.min, writeMax: cur.writeDelay.max, maxReplyRealHours: cur.maxReplyRealHours, timeScale: cur.timeScale || 1, personaId: cur.personaId || '',
      } : {
        name: '', brief: '', world: '', ratio: 1, deliveryMin: 1, deliveryMax: 24, writeMin: 2, writeMax: 48, maxReplyRealHours: 24, timeScale: 1,
        personaId: S.persona !== ALL && S.persona !== NO_PERSONA ? S.persona : S.activePersonaId,
      };
      const inputs = {};
      const text = (k, ph, rows) => (inputs[k] = rows ? el('textarea', { value: v[k] || '', placeholder: ph, rows }) : el('input', { value: v[k] ?? '', placeholder: ph }));
      const numIn = (k, step = 'any') => (inputs[k] = el('input', { type: 'number', step, min: '0', value: String(v[k] ?? '') }));
      inputs.personaId = el('select', {}, [
        el('option', { value: '', text: '페르소나 없음(보낼 때 활성 페르소나)' }),
        ...S.personas.map((p) => el('option', { value: p.id, text: p.title ? `${p.name} — ${p.title}` : p.name, selected: p.id === v.personaId })),
      ]);
      const read = () => Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value]));
      return [
        el('div', { class: 'im-row' }, [link('← 돌아가기', () => (editing ? go({ name: 'c', id: view.id }) : go({ name: 'home' })))]),
        el('h3', { text: editing ? '상대 정보 수정' : '새 상대' }),
        field('편지를 쓰는 나 (페르소나)', inputs.personaId),
        el('div', { class: 'im-muted', text: '상대를 직접 적습니다. 캐릭터 카드·로어북 자동 생성과 무작위 매칭은 다음 단계에서 붙습니다.' }),
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
              await ask('update', { id: view.id, input: read() });
              await refresh();
              go({ name: 'c', id: view.id });
            } else {
              const r = await ask('create', { input: read() });
              const pid = inputs.personaId.value;
              if (pid && S.persona !== ALL) setPersona(pid);
              await refresh();
              go({ name: 'c', id: r.id });
            }
          }), { primary: true, disabled: busy }),
          editing ? btn('상대 지우기', () => act(async () => {
            if (!confirm('이 상대와 주고받은 편지·물품 기록을 모두 지울까요? 되돌릴 수 없습니다.')) return;
            await ask('delete', { id: view.id });
            await refresh();
            go({ name: 'home' });
          })) : null,
        ]),
      ];
    }

    function settingsView() {
      const s = { ...(S.settings || {}) };
      if (!connections) {
        connections = [];
        ask('connections').then((r) => { connections = r.connections; render(); }).catch((e) => { error = e.message; render(); });
      }
      const sel = el('select', {}, [
        el('option', { value: '', text: '기본 연결 사용' }),
        ...connections.map((x) => el('option', { value: x.id, text: `${x.name} — ${x.model || x.provider}${x.is_default ? ' (기본)' : ''}`, selected: x.id === s.replyConnectionId })),
      ]);
      const temp = el('input', { type: 'number', step: '0.05', min: '0', max: '2', value: String(s.temperature ?? 0.9) });
      const csel = el('select', {}, [
        el('option', { value: '', text: '답장 연결과 같게' }),
        ...connections.map((x) => el('option', { value: x.id, text: `${x.name} — ${x.model || x.provider}`, selected: x.id === s.createConnectionId })),
      ]);
      const ctemp = el('input', { type: 'number', step: '0.05', min: '0', max: '2', value: String(s.createTemperature ?? 1) });
      const orgOn = el('input', { type: 'checkbox', style: 'width:auto', checked: s.organizeEnabled !== false });
      const A = { connectionId: '', model: '', style: '', size: '1024x1024', paperSize: '1024x1024', perDay: 6, autoItems: 'off', ...(s.art || {}) };
      if (!imageConns) { imageConns = []; ask('imageConnections').then((r) => { imageConns = r.connections; render(); }).catch(() => {}); }
      const isel = el('select', {}, [
        el('option', { value: '', text: '앱 기본 이미지 연결' }),
        ...imageConns.map((x) => el('option', { value: x.id, text: `${x.name} — ${x.model || x.provider}${x.is_default ? ' (기본)' : ''}`, selected: x.id === A.connectionId })),
      ]);
      const imodel = el('input', { value: A.model, placeholder: '목록에서 고르거나 직접 적기 (비우면 연결의 모델)', list: 'im-image-models' });
      const ilist = el('datalist', { id: 'im-image-models' });
      const imodelNote = el('div', { class: 'im-muted', text: '' });
      const showModels = (r) => {
        ilist.replaceChildren(...r.models.map((m) => el('option', { value: m.id, text: m.label !== m.id ? m.label : '' })));
        imodelNote.textContent = `모델 ${r.models.length}개${r.current ? ` · 이 연결의 기본 모델: ${r.current}` : ''}. 칸을 비우면 기본 모델을 씁니다.`;
      };
      const loadModels = (connId) => {
        if (modelCache[connId || '']) { showModels(modelCache[connId || '']); return; }
        imodelNote.textContent = '모델 목록을 불러오는 중…';
        ask('imageModels', { connectionId: connId }, 30000).then((r) => {
          modelCache[connId || ''] = r;
          ilist.replaceChildren(...r.models.map((m) => el('option', { value: m.id, text: m.label !== m.id ? m.label : '' })));
          imodelNote.textContent = `모델 ${r.models.length}개${r.current ? ` · 이 연결의 기본 모델: ${r.current}` : ''}. 칸을 비우면 기본 모델을 씁니다.`;
        }).catch((e) => { imodelNote.textContent = `모델 목록을 못 불러왔습니다: ${e.message}`; });
      };
      isel.addEventListener('change', () => loadModels(isel.value));
      loadModels(isel.value);
      const istyle = el('textarea', { value: A.style, rows: 3, placeholder: 'hand-painted storybook illustration, delicate ink linework, soft watercolor washes, …' });
      const KINDS = [['paper', '편지지'], ['stamp', '우표'], ['seal', '봉인'], ['item', '물건']];
      const DEF_T = {
        paper: 'flat 2D stationery design … ornamental border and small corner vignettes showing {subject}, large blank center …, {style}',
        stamp: 'flat 2D postage stamp design … vintage engraved illustration of {subject} …, {style}',
        seal: 'flat 2D illustration of a seal impression seen from directly above, {subject} …, {style}',
        item: 'highly detailed illustration of {subject}, intricate textures … single object on plain paper background, {style}',
      };
      const kIn = Object.fromEntries(KINDS.map(([k]) => [k, {
        model: el('input', { value: A.kinds?.[k]?.model || '', placeholder: '비우면 위 모델', list: 'im-image-models' }),
        template: el('textarea', { value: A.kinds?.[k]?.template || '', rows: 3, placeholder: `비우면 기본 양식: ${DEF_T[k]}` }),
      }]));
      const ineg = el('input', { type: 'checkbox', style: 'width:auto', checked: !!A.sendNegative });
      const inegText = el('textarea', { value: A.negative || '', rows: 2, placeholder: '비우면 기본 금지어(사진·탁자·사람·글자·숫자 등)' });
      const istrength = el('input', { type: 'number', min: '0', max: '100', step: '5', value: String(A.paperStrength ?? 70) });
      const iborder = el('input', { type: 'number', min: '0', max: '200', step: '2', value: String(A.paperBorder ?? 64) });
      const islice = el('input', { type: 'number', min: '1', max: '45', step: '1', value: String(A.paperSlice ?? 20) });
      const isize = el('input', { value: A.size, placeholder: '1024x1024' });
      const ipsize = el('input', { value: A.paperSize, placeholder: '1024x1024' });
      const iday = el('input', { type: 'number', min: '0', step: '1', value: String(A.perDay) });
      const iauto = el('select', {}, [el('option', { value: 'off', text: '끔', selected: A.autoItems !== 'all' }), el('option', { value: 'all', text: '켬', selected: A.autoItems === 'all' })]);
      const osel = el('select', {}, [
        el('option', { value: '', text: '답장 연결과 같게' }),
        ...connections.map((x) => el('option', { value: x.id, text: `${x.name} — ${x.model || x.provider}`, selected: x.id === s.organizeConnectionId })),
      ]);
      const otemp = el('input', { type: 'number', step: '0.05', min: '0', max: '2', value: String(s.organizeTemperature ?? 0.3) });
      const B = { summaries: 20, summaryChars: 2400, chapterChars: 1600, chapterEvery: 10, timelineItems: 12, ledgerChars: 1600, loreChars: 6000, recallChars: 1800, ...(s.budgets || {}) };
      const BL = [['summaries', '편지 요약 통수'], ['summaryChars', '편지 요약 글자'], ['chapterChars', '시기 요약 글자'], ['chapterEvery', '시기 요약 간격(통)'], ['timelineItems', '그쪽 사건 개수'], ['ledgerChars', '관계 장부 글자'], ['loreChars', '로어북 글자'], ['recallChars', '옛 편지 회상 글자(0=끔)']];
      const bIn = Object.fromEntries(BL.map(([k]) => [k, el('input', { type: 'number', step: '1', min: '0', value: String(B[k]) })]));
      const maxT = el('input', { type: 'number', step: '100', min: '500', value: String(s.maxTokens ?? 6000) });
      const recent = el('input', { type: 'number', step: '1', min: '1', max: '20', value: String(s.recentLetters ?? 6) });
      const exact = el('input', { type: 'checkbox', checked: !!s.showExactEta, style: 'width:auto' });
      return [
        el('div', { class: 'im-row' }, [link('← 우편함', () => go({ name: 'home' }))]),
        el('h3', { text: '설정' }),
        field('답장 쓰기 연결', sel),
        field('상대 만들기 연결 (비우면 답장 연결)', csel),
        field('상대 만들기 온도', ctemp),
        el('h4', { text: '정리 단계 (답장마다 1회 더 생성)' }),
        el('label', { class: 'im-row', style: 'flex-direction:row' }, [orgOn, '답장이 오면 요약·관계 장부·로어북·카드를 정리하기']),
        field('정리 연결 (비우면 답장 연결)', osel),
        field('정리 온도', otemp),
        el('h4', { text: '기억 예산 (프롬프트에 넣는 양)' }),
        el('div', { class: 'im-pair' }, BL.map(([k, t]) => field(t, bIn[k]))),
        el('div', { class: 'im-muted', text: '최근 원문 통수는 위 「최근 편지 수」입니다. 예산을 넘어 빠진 양은 상대 서류함의 모의 조립에서 보입니다.' }),
        el('div', { class: 'im-pair' }, [field('온도', temp), field('최대 출력 토큰', maxT)]),
        field('프롬프트에 넣는 최근 편지 수(양쪽 합)', recent),
        el('label', { class: 'im-row', style: 'flex-direction:row' }, [exact, '배송 중 남은 시간을 분 단위로 보기']),
        el('div', { class: 'im-muted', text: '연결에 붙은 프리셋은 쓰지 않고, 우체통이 자기 지시문과 위 값을 보냅니다.' }),
        el('h4', { text: '그림 (NanoGPT 등 이미지 연결)' }),
        field('이미지 연결', isel),
        field('기본 모델', imodel),
        ilist,
        imodelNote,
        field('전체 룩 (영어, 양식의 {style} 자리에 들어감)', istyle),
        el('details', {}, [
          el('summary', { class: 'im-muted', style: 'cursor:pointer', text: '종류별 양식·모델 (편지지·우표·봉인·물건)' }),
          el('div', { class: 'im-muted', text: '{subject}는 글 생성이 써 주는 주제, {style}은 위 전체 룩입니다. 비우면 기본 양식(평면 도안·세밀한 물건 그림)을 씁니다.' }),
          ...KINDS.flatMap(([k, t]) => [el('h4', { text: t }), field('모델', kIn[k].model), field('양식', kIn[k].template)]),
        ]),
        el('label', { class: 'im-row', style: 'flex-direction:row' }, [ineg, '금지어를 negative prompt로 보내기 (받지 않는 모델이 많아요. 거절되면 빼고 다시 시도합니다)']),
        field('금지어', inegText),
        el('div', { class: 'im-pair' }, [
          field('편지지 테두리 두께(px) — 글씨는 이 안쪽에만', iborder),
          field('그림에서 테두리로 쓸 비율(%)', islice),
          field('글씨 칸 선명도 (100=그림 그대로, 낮을수록 크림색으로 덮음)', istrength),
        ]),
        el('div', { class: 'im-muted', text: '편지지 그림은 액자처럼 씁니다: 모서리·테두리는 늘리지 않고 편지 길이에 맞춰 가장자리만 이어 붙입니다. 장식이 글씨에 닿으면 두께나 비율을 올려 주세요.' }),
        el('div', { class: 'im-pair' }, [field('크기', isize), field('편지지 크기', ipsize), field('하루 최대 장수', iday), field('받은 물건 자동 그리기', iauto)]),
        el('div', { class: 'im-muted', text: '사람·얼굴·손·글자는 그리지 않습니다. 만든 그림은 이 브라우저에서 WebP로 바꿔 다시 저장합니다(원본 png는 지움).' }),
        el('h4', { text: '편지첩 여는 방식 (이 기기, 새로 고침 뒤 적용)' }),
        el('select', { onchange: (e) => { lsSet(LS_PANEL_MODE, e.target.value); error = '여는 방식을 바꿨습니다. 페이지를 새로 고치면 적용됩니다.'; render(); } }, [
          el('option', { value: 'page', text: '채팅창처럼 화면 가득 (왼쪽 상대 목록 + 편지첩) — 권한 app_manipulation 필요', selected: lsGet(LS_PANEL_MODE, 'page') === 'page' }),
          el('option', { value: 'dock', text: '오른쪽에 붙이기 (메인 화면이 옆으로 밀림)', selected: lsGet(LS_PANEL_MODE, 'page') === 'dock' }),
          el('option', { value: 'float', text: '떠 있는 창 (메인 화면 위에 겹침, 끌어서 옮김)', selected: lsGet(LS_PANEL_MODE, 'page') === 'float' }),
        ]),
        el('div', { class: 'im-muted', text: pageMode ? '지금: 채팅창처럼 화면 가득' : panelMode === 'float' ? '지금: 떠 있는 창' : (lsGet(LS_PANEL_MODE, 'page') === 'page' ? '지금: 오른쪽에 붙이기 (화면 가득 방식은 확장 패널에서 app_manipulation 권한을 승인해야 합니다)' : '지금: 오른쪽에 붙이기') }),
        btn('저장', () => act(async () => {
          S.settings = (await ask('saveSettings', { settings: { replyConnectionId: sel.value, createConnectionId: csel.value, createTemperature: ctemp.value, art: { connectionId: isel.value, model: imodel.value, style: istyle.value, size: isize.value, paperSize: ipsize.value, perDay: Number(iday.value), autoItems: iauto.value, sendNegative: ineg.checked, negative: inegText.value, paperStrength: Number(istrength.value), paperBorder: Number(iborder.value), paperSlice: Number(islice.value), kinds: Object.fromEntries(Object.entries(kIn).map(([k, v]) => [k, { model: v.model.value, template: v.template.value }])) }, organizeEnabled: orgOn.checked, organizeConnectionId: osel.value, organizeTemperature: otemp.value, budgets: Object.fromEntries(Object.entries(bIn).map(([k, i]) => [k, Number(i.value)])), temperature: temp.value, maxTokens: maxT.value, recentLetters: recent.value, showExactEta: exact.checked } })).settings;
          go({ name: 'home' });
        }), { primary: true }),
      ];
    }

    // ── 새 상대(매칭) ──
    const M = { mode: 'prompt', request: '', dice: '', exclude: '', characterId: '', personaId: '', firstBy: 'them', ratioMin: '', ratioMax: '', deliveryMin: '', deliveryMax: '', timeScale: '1', characters: null, draft: null };
    const MODES = [['prompt', '원하는 상대 적기'], ['random', '무작위로 만나기'], ['existing', '기존 캐릭터'], ['manual', '직접 다 적기']];
    function matchView() {
      if (!M.personaId) M.personaId = S.persona !== ALL && S.persona !== NO_PERSONA ? S.persona : S.activePersonaId;
      if (M.mode === 'existing' && !M.characters) {
        M.characters = [];
        ask('characters').then((r) => { M.characters = r.characters; render(); }).catch((e) => { error = e.message; render(); });
      }
      const bind = (k, tag = 'input', props = {}) => el(tag, { ...props, value: M[k], oninput: (e) => { M[k] = e.target.value; } });
      const personaSel = el('select', { onchange: (e) => { M.personaId = e.target.value; } }, [
        el('option', { value: '', text: '페르소나 없음(보낼 때 활성 페르소나)' }),
        ...S.personas.map((p) => el('option', { value: p.id, text: p.title ? `${p.name} — ${p.title}` : p.name, selected: p.id === M.personaId })),
      ]);
      const body = [];
      if (M.mode === 'prompt') {
        body.push(field('어떤 상대와 편지하고 싶나요?', bind('request', 'textarea', { rows: 5, placeholder: '예: 눈 덮인 곶의 늙은 등대지기. 무뚝뚝하지만 편지는 꼬박꼬박 길게 쓴다. 바다가 얼면 새가 편지를 나른다.' })));
      } else if (M.mode === 'random') {
        body.push(field('세계의 씨앗 (비우면 주사위)', bind('dice', 'input', { placeholder: '예: 사막의 대상로 / 하늘에 뜬 섬' })));
        body.push(field('빼고 싶은 소재 (선택)', bind('exclude', 'input', { placeholder: '예: 전쟁, 용' })));
      } else if (M.mode === 'existing') {
        body.push(field('편지할 캐릭터', el('select', { onchange: (e) => { M.characterId = e.target.value; } }, [
          el('option', { value: '', text: M.characters?.length ? '고르기' : '불러오는 중…' }),
          ...(M.characters || []).map((c) => el('option', { value: c.id, text: c.books ? `${c.name} (로어북 ${c.books})` : c.name, selected: c.id === M.characterId })),
        ])));
        body.push(el('div', { class: 'im-muted', text: '원본 카드와 로어북은 바꾸지 않고, 우편 설정과 「〈이름〉 · 우체통」 로어북만 새로 만듭니다.' }));
      }
      return [
        el('div', { class: 'im-row' }, [link('← 우편함', () => go({ name: 'home' }))]),
        el('h3', { text: '새 상대' }),
        el('div', { class: 'im-chips' }, MODES.map(([k, t]) => el('button', { class: `im-chip im-plain${M.mode === k ? ' im-on' : ''}`, type: 'button', text: t, onclick: () => {
          if (k === 'manual') { go({ name: 'form' }); return; }
          M.mode = k; render();
        } }))),
        field('편지를 쓰는 나 (페르소나)', personaSel),
        ...body,
        field('첫 편지', el('select', { onchange: (e) => { M.firstBy = e.target.value; } }, [
          el('option', { value: 'them', text: '상대가 먼저 (낯선 편지가 도착)', selected: M.firstBy === 'them' }),
          el('option', { value: 'me', text: '내가 먼저', selected: M.firstBy === 'me' }),
        ])),
        el('details', {}, [
          el('summary', { class: 'im-muted', style: 'cursor:pointer', text: '시간 범위 정하기 (비우면 세계에 맞춰 AI가 정함)' }),
          el('div', { class: 'im-pair' }, [
            field('시간 비율 최소', bind('ratioMin', 'input', { type: 'number', step: 'any', min: '0' })),
            field('시간 비율 최대', bind('ratioMax', 'input', { type: 'number', step: 'any', min: '0' })),
            field('배송 최소(시간)', bind('deliveryMin', 'input', { type: 'number', step: 'any', min: '0' })),
            field('배송 최대(시간)', bind('deliveryMax', 'input', { type: 'number', step: 'any', min: '0' })),
          ]),
          field('시험용 시간 가속 (1=실제)', bind('timeScale', 'input', { type: 'number', step: '1', min: '1' })),
        ]),
        el('div', { class: 'im-muted', text: '「만들기」를 누르면 상대 만들기 연결로 생성을 1회 합니다. 미리보기에서 고치고 확정해야 캐릭터·로어북이 만들어집니다.' }),
        btn(busy ? '만드는 중… (30초~1분)' : '만들기', () => act(async () => {
          const r = await ask('matchDraft', {
            mode: M.mode, request: M.request, dice: M.dice, exclude: M.exclude, characterId: M.characterId, personaId: M.personaId, firstBy: M.firstBy,
            ranges: { ratioMin: M.ratioMin, ratioMax: M.ratioMax, deliveryMin: M.deliveryMin, deliveryMax: M.deliveryMax },
          }, 240000);
          M.draft = r.draft;
          view = { name: 'preview' };
        }), { primary: true, disabled: busy }),
      ];
    }

    // 미리보기: 모든 칸을 고칠 수 있다
    function previewView() {
      const d = M.draft;
      if (!d) return [link('← 새 상대', () => go({ name: 'match' }))];
      const txt = (obj, k, rows, ph = '') => el(rows ? 'textarea' : 'input', { value: obj[k] ?? '', rows, placeholder: ph, oninput: (e) => { obj[k] = e.target.value; } });
      const numIn = (obj, k) => el('input', { type: 'number', step: 'any', min: '0', value: String(obj[k] ?? ''), oninput: (e) => { obj[k] = e.target.value; } });
      const entryNodes = d.entries.map((e, i) => el('div', { class: 'im-letter' }, [
        el('div', { class: 'im-row' }, [
          el('input', { value: e.title, class: 'im-grow', style: 'flex:1', oninput: (ev) => { e.title = ev.target.value; } }),
          el('label', { class: 'im-row', style: 'flex-direction:row;white-space:nowrap' }, [el('input', { type: 'checkbox', style: 'width:auto', checked: e.constant, onchange: (ev) => { e.constant = ev.target.checked; render(); } }), '항상']),
          link('빼기', () => { d.entries.splice(i, 1); render(); }),
        ]),
        e.constant ? null : el('input', { value: e.keys.join(', '), placeholder: '키워드(쉼표로)', oninput: (ev) => { e.keys = ev.target.value.split(',').map((x) => x.trim()).filter(Boolean); } }),
        el('textarea', { value: e.content, rows: 4, oninput: (ev) => { e.content = ev.target.value; } }),
      ]));
      const fl = d.firstLetter;
      return [
        el('div', { class: 'im-row' }, [link('← 다시 적기', () => go({ name: 'match' })), el('span', { class: 'im-grow' }), btn(busy ? '…' : '다시 만들기(1회)', () => act(async () => {
          const r = await ask('matchDraft', {
            mode: M.mode, request: M.request, dice: d.dice || M.dice, exclude: M.exclude, characterId: M.characterId, personaId: M.personaId, firstBy: M.firstBy,
            ranges: { ratioMin: M.ratioMin, ratioMax: M.ratioMax, deliveryMin: M.deliveryMin, deliveryMax: M.deliveryMax },
          }, 240000);
          M.draft = r.draft;
        }), { disabled: busy })]),
        el('h3', { text: '미리보기' }),
        d.dice ? el('div', { class: 'im-muted', text: `세계의 씨앗: ${d.dice}` }) : null,
        d.warnings?.length ? el('div', { class: 'im-err', text: `확인할 점: ${d.warnings.join(' / ')}` }) : null,
        field('이름', txt(d, 'name')),
        d.card ? el('div', { style: 'display:flex;flex-direction:column;gap:8px' }, [
          el('h4', { text: '캐릭터 카드' }),
          field('description', txt(d.card, 'description', 10)),
          field('personality', txt(d.card, 'personality', 6)),
          field('never (post_history_instructions)', txt(d.card, 'never')),
        ]) : el('div', { class: 'im-muted', text: '기존 캐릭터 카드를 그대로 씁니다.' }),
        el('h4', { text: '시간과 우편' }),
        d.mail.ratioReason ? el('div', { class: 'im-muted', text: d.mail.ratioReason }) : null,
        el('div', { class: 'im-pair' }, [
          field('시간 비율 (나의 1 = 그쪽 ?)', numIn(d.mail, 'ratio')),
          field('배송 최소(현실 시간)', numIn(d.mail, 'deliveryMin')),
          field('배송 최대(현실 시간)', numIn(d.mail, 'deliveryMax')),
          field('답장 쓰는 데 최소(그쪽 시간)', numIn(d.mail, 'writeMin')),
          field('답장 쓰는 데 최대(그쪽 시간)', numIn(d.mail, 'writeMax')),
          field('편지 매체', txt(d.mail, 'medium')),
          field('봉인', txt(d.mail, 'seal')),
          field('우표·표식', txt(d.mail, 'stampMotif')),
          field('냄새', txt(d.mail, 'scent')),
          field('감촉', txt(d.mail, 'texture')),
        ]),
        el('h4', { text: `로어북 「${d.worldTitle}」 · ${d.entries.length}항목` }),
        ...entryNodes,
        link('+ 항목 더하기', () => { d.entries.push({ title: '새 항목', keys: [], content: '', constant: false }); render(); }),
        fl ? el('div', { style: 'display:flex;flex-direction:column;gap:6px' }, [
          el('h4', { text: '상대의 첫 편지' }),
          el('div', { class: 'im-paper im-theirs' }, [
            el('div', { class: 'im-meta', text: [fl.envelope?.medium, fl.envelope?.scent].filter(Boolean).join(' · ') }),
            el('div', { text: fl.body + (fl.ps ? `\n\n추신. ${fl.ps}` : '') }),
            fl.enclosures?.length ? el('div', { class: 'im-encl' }, fl.enclosures.map((x) => el('div', { text: `동봉 · ${x.item}` }))) : null,
          ]),
          el('div', { class: 'im-muted', text: '확정하면 이 편지가 배송되기 시작합니다(미리 읽은 셈이지만, 도착하면 봉투부터 다시 열어 볼 수 있어요).' }),
        ]) : el('div', { class: 'im-muted', text: '첫 편지는 내가 씁니다.' }),
        btn(busy ? '만드는 중…' : '확정 — 캐릭터·로어북 만들기', () => act(async () => {
          const r = await ask('matchConfirm', { draft: d, personaId: M.personaId, timeScale: M.timeScale }, 60000);
          M.draft = null;
          await refresh();
          go({ name: 'c', id: r.id });
        }), { primary: true, disabled: busy }),
      ];
    }

    // ── 상대 서류함 ──
    let D = null; // { id, data }
    async function openDossier(id) {
      view = { name: 'dossier', id };
      D = null; render();
      try { D = { id, data: await ask('dossier', { id }) }; } catch (e) { error = e.message; }
      render();
    }
    const STATE = { applied: '적용됨', pending: '승인 대기', apply: '적용 중', failed: '실패', reverted: '되돌림', rejected: '거절', locked: '잠김(제안만)', conflict: '충돌' };
    const MODE_LABEL = { auto: '자동', approve: '승인 후', off: '끔' };
    function dossierView() {
      const c = byId(view.id);
      const back = el('div', { class: 'im-row' }, [link(`← ${c?.name || '상대'}`, () => go({ name: 'c', id: view.id })), el('span', { class: 'im-grow' }), link('새로 고침', () => openDossier(view.id))]);
      if (!D || D.id !== view.id) return [back, el('div', { class: 'im-muted', text: '불러오는 중…' })];
      const d = D.data;
      const L = d.memory.ledger || {};
      const list = (title, items, fmt) => (items?.length ? el('div', {}, [el('b', { text: title }), ...items.map((x) => el('div', { class: 'im-muted', text: `· ${fmt ? fmt(x) : x}` }))]) : null);
      const o = d.organize;
      const doAct = (fn) => act(async () => { await fn(); await openDossier(view.id); });
      const changeRow = (x) => el('div', { class: 'im-letter' }, [
        el('div', { class: 'im-row' }, [
          el('b', { class: 'im-grow', text: `${x.target === 'lore' ? '로어북' : x.target === 'card' ? '카드' : '충돌'} · ${x.key}${x.op === 'add' ? ' (새로)' : ''}` }),
          el('span', { class: x.state === 'failed' || x.state === 'conflict' ? 'im-err' : 'im-muted', text: STATE[x.state] || x.state }),
        ]),
        x.reason ? el('div', { class: 'im-muted', text: `이유: ${x.reason}` }) : null,
        x.before ? el('div', { class: 'im-muted', style: 'text-decoration:line-through', text: short(x.before, 300) }) : null,
        x.after ? el('div', { text: short(x.after, 400) }) : null,
        x.error ? el('div', { class: 'im-err', text: x.error }) : null,
        el('div', { class: 'im-row' }, [
          ['pending', 'locked', 'failed'].includes(x.state) && x.target !== 'conflict' ? btn('적용', () => doAct(() => ask('change', { id: view.id, changeId: x.id, action: 'approve' }))) : null,
          ['pending', 'locked', 'failed', 'conflict'].includes(x.state) ? btn(x.state === 'conflict' ? '확인함' : '거절', () => doAct(() => ask('change', { id: view.id, changeId: x.id, action: 'reject' }))) : null,
          x.state === 'applied' ? btn('되돌리기', () => doAct(() => ask('change', { id: view.id, changeId: x.id, action: 'revert' }))) : null,
        ]),
      ]);
      const changes = [...(d.memory.changes || [])].reverse();
      const waiting = changes.filter((x) => ['pending', 'conflict', 'failed'].includes(x.state));
      // 규칙
      const lockText = el('input', { value: d.locks.join(', '), placeholder: 'first_line, core, fixed, never, 세계 개요' });
      const modeSel = (k, label) => field(label, el('select', { 'data-k': k }, ['auto', 'approve', 'off'].map((m) => el('option', { value: m, text: MODE_LABEL[m], selected: d.applyMode[k] === m }))));
      const modes = el('div', { class: 'im-pair' }, [
        modeSel('loreAdd', '로어북 추가'), modeSel('loreEdit', '로어북 수정'), modeSel('cardAdd', '카드 칸 추가'), modeSel('cardEdit', '카드 칸 수정'), modeSel('origLore', '원본 캐릭터 로어북 수정'),
      ]);
      return [
        back,
        el('h3', { text: `${c?.name || ''} 서류함` }),
        // 정리 상태
        o ? el('div', { class: o.state === 'failed' ? 'im-err' : 'im-muted', text: o.state === 'failed' ? `정리 실패: ${o.error || ''}` : `정리 대기 중 · 편지 ${o.forLetterIds.length}통${o.error ? ` (재시도: ${o.error})` : ''}` }) : null,
        el('div', { class: 'im-row' }, [btn('아직 정리 안 된 편지 정리하기(생성 1회)', () => doAct(() => ask('organizeNow', { id: view.id })))]),
        // 그림
        el('h4', { text: `그림${S.art?.left !== undefined ? ` · 오늘 남은 ${S.art.left}장` : ''}` }),
        c ? artBar(c, doAct) : null,
        el('div', { class: 'im-grid' }, ['paper', 'stamp', 'seal'].map((k) => {
          const img = c?.art?.[k]?.imageId;
          const label = { paper: '편지지', stamp: '우표', seal: '봉인' }[k];
          return el('div', { class: 'im-item' }, [
            el('div', { class: 'im-pic' }, [img ? el('a', { href: `/api/v1/images/${img}`, target: '_blank', rel: 'noopener' }, [el('img', { src: imgUrl(img, 'lg'), alt: label, loading: 'lazy' })]) : el('span', { html: PIC }), stateOverlay(artTarget(c, k))]),
            el('div', { class: 'im-cap' }, [el('b', { text: label }), link(img ? '다시 그리기' : '그리기', () => doAct(async () => {
              if (!confirm(`${label}을(를) ${img ? '다시 ' : ''}그립니다. 이미지 1장 + 글 생성 1회. 계속할까요?`)) return;
              await ask('drawSet', { id: view.id, kinds: [k] });
            }))]),
          ]);
        })),
        // 관계 장부
        el('h4', { text: '관계 장부' }),
        L.stage || L.mood || L.calledMe ? el('div', { class: 'im-muted', text: [L.stage && `거리: ${L.stage}`, L.mood && `상대 마음: ${L.mood}`, L.calledMe && `나를 부르는 말: ${L.calledMe}`, L.calledThem && `내가 부르는 말: ${L.calledThem}`].filter(Boolean).join(' · ') }) : el('div', { class: 'im-muted', text: '아직 기록이 없습니다.' }),
        list('약속', L.promises, (x) => `${x.who === 'me' ? '나' : '상대'}: ${x.what}${x.state === 'done' ? ' (지킴)' : ''}`),
        list('아직 답 못 받은 질문', L.openQuestions, (x) => `${x.who === 'me' ? '내가' : '상대가'} 물음: ${x.q}`),
        list('상대가 아는 나', L.knowsAboutMe),
        list('내가 아는 상대', L.iKnow),
        list('기억할 날', L.anniversaries),
        // 연대기
        el('h4', { text: '그쪽 연대기' }),
        d.memory.timeline?.length ? el('div', {}, [...d.memory.timeline].reverse().slice(0, 40).map((e) => el('div', { class: e.open ? '' : 'im-muted', text: `${e.open ? '● ' : '· '}${e.when ? `[${e.when}] ` : ''}${e.event}` }))) : el('div', { class: 'im-muted', text: '아직 기록이 없습니다.' }),
        d.memory.chapters?.length ? el('div', {}, [el('h4', { text: '시기 요약' }), ...d.memory.chapters.map((x, i) => el('div', { class: 'im-muted', text: `${i + 1}장 · ${x.text}` }))]) : null,
        d.memory.summaries?.length ? el('details', {}, [el('summary', { class: 'im-muted', style: 'cursor:pointer', text: `편지 요약 ${d.memory.summaries.length}통` }), ...d.memory.summaries.map((x) => el('div', { class: 'im-muted', text: `[${x.when}] ${x.from === 'me' ? '나' : '상대'}: ${x.text}` }))]) : null,
        // 변경 기록
        el('h4', { text: `변경 기록 · 확인 필요 ${waiting.length}` }),
        ...(changes.length ? changes.slice(0, 60).map(changeRow) : [el('div', { class: 'im-muted', text: '아직 변경이 없습니다.' })]),
        // 규칙
        el('h4', { text: '규칙' }),
        field('잠근 칸 (쉼표로: first_line, core, fixed, never, look, … 또는 로어북 항목 제목)', lockText),
        modes,
        btn('규칙 저장', () => doAct(async () => {
          const applyMode = Object.fromEntries([...modes.querySelectorAll('select')].map((x) => [x.getAttribute('data-k'), x.value]));
          await ask('setRules', { id: view.id, locks: lockText.value.split(',').map((x) => x.trim()).filter(Boolean), applyMode });
        })),
        // 모의 조립
        el('h4', { text: `다음 답장 모의 조립 · 약 ${d.totalTokens.toLocaleString()}토큰` }),
        el('div', {}, d.report.map((r) => el('div', { class: 'im-row' }, [el('span', { class: 'im-grow', text: r.layer }), el('span', { class: 'im-muted', text: `${r.chars.toLocaleString()}자 · 약 ${r.tokens.toLocaleString()}토큰${r.note ? ` · ${r.note}` : ''}` })]))),
        el('details', {}, [el('summary', { class: 'im-muted', style: 'cursor:pointer', text: '실제로 보낼 프롬프트 전체 보기' }), el('pre', { style: 'white-space:pre-wrap;font-size:11px;max-height:420px;overflow:auto', text: d.prompt })]),
      ];
    }

    return { render, go };
  })();
  views.add(drawer);

  // 상대 편지 한 통(봉투 → 편지지). 서랍·보조창 공용
  function theirLetterNode(c, l, { act }) {
    const e = l.envelope || {};
    if (l.state === 'delivered') {
      const rows = [['매체', e.medium], ['손끝에 닿는 것', e.texture], ['냄새', e.scent], ['흔적', e.marks], ['봉인', e.seal], ['우표', e.stamp]].filter(([, v]) => v);
      const sealImg = c.art?.seal?.imageId;
      return el('div', { class: 'im-envelope' }, [
        sealImg ? el('img', { src: imgUrl(sealImg, 'sm'), alt: '봉인', style: 'position:absolute;right:12px;top:12px;width:64px;height:64px;object-fit:cover;border-radius:50%;box-shadow:0 2px 6px #0004' }) : null,
        el('div', { style: 'font-size:12px;color:#7a6a52', text: `${c.name}에게서 · ${when(l.arriveAt)} 도착` }),
        el('dl', { style: 'margin:0' }, rows.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })])),
        l.enclosures?.length ? el('div', { style: 'font-size:12px;color:#7a6a52', text: `안에 무언가 더 들어 있는 것 같습니다 (${l.enclosures.length})` }) : null,
        btn('봉투 열기', () => act(async () => { await ask('open', { id: c.id, letterId: l.id }); await refresh(); })),
      ]);
    }
    const meta = [l.writtenLabel || l.theirWrittenLabel, e.medium, e.scent].filter(Boolean).join(' · ');
    const paperImg = c.art?.paper?.imageId;
    const stampImg = c.art?.stamp?.imageId;
    const A = S.settings?.art || {};
    const num = (v, d) => (Number.isFinite(Number(v)) && v !== '' && v !== null && v !== undefined ? Number(v) : d);
    const fade = Math.max(0, Math.min(0.9, (100 - num(A.paperStrength, 70)) / 100));
    // 좁은 화면(휴대폰)에서는 테두리·여백을 줄여 글씨 칸을 넓힌다
    const narrow = typeof window !== 'undefined' && window.innerWidth < 520;
    const bw = Math.round(Math.max(0, Math.min(200, num(A.paperBorder, 64))) * (narrow ? 0.6 : 1));
    const slice = Math.max(1, Math.min(45, num(A.paperSlice, 20)));
    const paperStyle = paperImg
      ? `border:${bw}px solid transparent;border-image:url("${imgUrl(paperImg, 'lg')}") ${slice}% fill / ${bw}px stretch;background:${fade ? `rgba(246,238,222,${fade})` : 'transparent'};background-clip:padding-box;box-shadow:none;border-radius:0;padding:${narrow ? '10px 8px' : '16px 18px'}`
      : undefined;
    return el('div', { class: `im-paper im-theirs${paperImg ? ' im-has-paper' : ''}`, style: paperStyle }, [
      el('div', { class: 'im-stamp', title: [e.stamp && `우표: ${e.stamp}`, e.seal && `봉인: ${e.seal}`].filter(Boolean).join('\n') }, [
        stampImg ? el('img', { src: imgUrl(stampImg, 'sm'), alt: '우표' }) : el('span', { style: 'font-size:18px;line-height:1', text: '✉' }),
      ]),
      el('div', { class: 'im-meta', text: `${c.name}의 편지 · ${meta}` }),
      el('div', { text: l.body + (l.ps ? `\n\n추신. ${l.ps}` : '') }),
      l.enclosures?.length ? el('div', { class: 'im-encl' }, l.enclosures.map((x) => el('div', { text: `동봉 · ${x.item}${x.note ? ` — ${x.note}` : ''}` }))) : null,
      el('div', { class: 'im-meta', style: 'margin:8px 0 0', text: `받은 시각 ${when(l.arriveAt)}` }),
    ]);
  }

  // ══════════════ 보조창(도크) + 우체통 위젯 ══════════════
  let panel = null;
  let widget = null;
  const P = { tab: lsGet(`${LS_PANEL}.tab`, 'book'), id: lsGet(`${LS_PANEL}.id`, ''), busy: false, error: '' };
  const panelRoot = el('div', { class: 'im-panel' });
  // 보조창 방식: page=채팅창처럼 앱 화면을 채움(기본, app_manipulation 필요) / dock=오른쪽에 붙이기 / float=떠 있는 창. 새로 고침 뒤 적용
  let panelMode = ['page', 'dock', 'float'].includes(lsGet(LS_PANEL_MODE, 'page')) ? lsGet(LS_PANEL_MODE, 'page') : 'page';
  let pageMode = false;
  if (panelMode === 'page') {
    try {
      if (typeof ctx.ui.mountApp !== 'function') throw new Error('mountApp 없음');
      const mount = ctx.ui.mountApp({ className: 'im-page-mount', position: 'app-overlay' });
      const closeBtn = el('button', { class: 'im-btn', type: 'button', text: '닫기', onclick: () => togglePanel(false) });
      const listCol = el('div', { class: 'im-page-list' });
      const mainCol = el('div', { class: 'im-page-main' }, [panelRoot]);
      const page = el('div', { class: 'im-page' }, [
        el('div', { class: 'im-page-head' }, [el('span', { html: ICON }), el('b', { class: 'im-grow', text: '이세계 우체통' }), closeBtn]),
        el('div', { class: 'im-page-body' }, [listCol, mainCol]),
      ]);
      mount.root.append(page);
      if (!removeStyle) mount.root.append(el('style', { text: CSS }));
      mount.setVisible(false);
      let visible = false;
      panel = {
        root: mount.root,
        listCol,
        isCollapsed: () => !visible,
        expand: () => { visible = true; mount.setVisible(true); },
        collapse: () => { visible = false; mount.setVisible(false); },
        destroy: () => mount.destroy(),
      };
      // Esc로 닫기
      const onKey = (e) => { if (e.key === 'Escape' && visible) togglePanel(false); };
      document.addEventListener('keydown', onKey);
      const d0 = panel.destroy;
      panel.destroy = () => { document.removeEventListener('keydown', onKey); d0(); };
      pageMode = true;
    } catch {
      panelMode = 'dock'; // 권한이 없거나 오래된 앱이면 오른쪽에 붙이기로
    }
  }
  try {
    if (pageMode) {
      // 위에서 만듦
    } else if (panelMode === 'float') {
      const w = Math.min(460, Math.max(320, window.innerWidth - 40));
      const h = Math.min(700, Math.max(360, window.innerHeight - 80));
      const fw = ctx.ui.createFloatWidget({ width: w, height: h, initialPosition: { x: Math.max(8, window.innerWidth - w - 24), y: 40 }, snapToEdge: false, tooltip: '이세계 우체통 · 편지첩', chromeless: false, touchScrollMode: 'native' });
      fw.setVisible(false);
      const head = el('div', { class: 'im-row', style: 'padding:6px 10px;border-bottom:1px solid var(--lumiverse-border);cursor:move;font-size:12px' }, [
        el('b', { class: 'im-grow', text: '이세계 우체통 · 편지첩' }),
        el('button', { class: 'im-link', type: 'button', text: '닫기', onclick: () => togglePanel(false) }),
      ]);
      // 창은 머리줄로만 옮긴다: 내용 칸에서 누르기가 위젯 끌기로 번지지 않게 막는다(글 고르기·스크롤·입력칸)
      const content = el('div', { class: 'im-float-content', style: 'flex:1;min-height:0;overflow:auto' }, [panelRoot]);
      for (const ev of ['pointerdown', 'mousedown', 'touchstart']) content.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });
      const box = el('div', { style: `display:flex;flex-direction:column;width:${w}px;height:${h}px;background:var(--lumiverse-fill);color:var(--lumiverse-text)` }, [head, content]);
      fw.root.append(box);
      if (!removeStyle) fw.root.append(el('style', { text: CSS }));
      panel = {
        root: fw.root,
        isCollapsed: () => !fw.isVisible(),
        expand: () => fw.setVisible(true),
        collapse: () => fw.setVisible(false),
        destroy: () => fw.destroy(),
      };
    } else {
      panel = ctx.ui.requestDockPanel({ edge: 'right', title: '이세계 우체통 · 편지첩', size: 440, minSize: 320, maxSize: 760, resizable: true, startCollapsed: true });
      panel.root.append(panelRoot);
      if (!removeStyle) panel.root.append(el('style', { text: CSS }));
      panel.onVisibilityChange?.((visible) => { if (visible) refresh(); renderWidget(); drawer.render(); });
    }
  } catch { panel = null; }

  function togglePanel(force) {
    if (!panel) return;
    const open = force ?? panel.isCollapsed();
    if (open) { panel.expand(); refresh(); } else panel.collapse();
    renderWidget();
    drawer.render();
  }
  function openPanelFor(id) {
    P.id = id; P.tab = 'book'; lsSet(`${LS_PANEL}.id`, id); lsSet(`${LS_PANEL}.tab`, 'book');
    togglePanel(true);
  }

  const panelView = {
    render() {
      if (!panel) return;
      const pact = async (fn) => {
        if (P.busy) return;
        P.busy = true; P.error = ''; panelView.render();
        try { await fn(); } catch (e) { P.error = e.message || String(e); }
        P.busy = false; panelView.render();
      };
      const mine = S.all.filter(inPersona);
      if (!mine.some((c) => c.id === P.id)) P.id = mine[0]?.id || '';
      const c = byId(P.id);
      const setTab = (t) => { P.tab = t; lsSet(`${LS_PANEL}.tab`, t); panelView.render(); };
      const people = el('div', { class: 'im-chips' }, mine.map((x) => {
        const unread = x.letters.filter((l) => l.from === 'them' && l.state === 'delivered').length;
        return el('button', { class: `im-chip im-plain${x.id === P.id ? ' im-on' : ''}`, type: 'button', onclick: () => { P.id = x.id; lsSet(`${LS_PANEL}.id`, x.id); panelView.render(); } }, [x.name, unread ? el('span', { class: 'im-badge', text: String(unread) }) : null]);
      }));
      const tabs = el('div', { class: 'im-tabs' }, [['book', '편지첩'], ['items', '물품'], ['album', '모음']].map(([k, t]) => el('button', { type: 'button', class: P.tab === k ? 'im-on' : '', text: t, onclick: () => setTab(k) })));
      let body = [];
      if (P.tab === 'album') body = albumView(mine);
      else if (!c) body = [el('div', { class: 'im-muted', text: S.all.length ? '이 페르소나와 편지를 주고받는 상대가 없습니다.' : '아직 상대가 없습니다. 서랍의 「우체통」 탭에서 새 상대를 만들어 주세요.' })];
      else if (P.tab === 'items') body = itemsView(c);
      else body = bookView(c, pact);
      if (pageMode && panel.listCol) {
        panel.listCol.replaceChildren(
          personaChips(),
          ...(mine.length ? mine.map((x) => {
            const unread = x.letters.filter((l) => l.from === 'them' && l.state === 'delivered').length;
            const s = S.list.find((y) => y.id === x.id);
            const last = [...x.letters].reverse().find((l) => l.body);
            return el('div', { class: `im-row-card${x.id === P.id ? ' im-on' : ''}`, onclick: () => { P.id = x.id; lsSet(`${LS_PANEL}.id`, x.id); panelView.render(); } }, [
              el('div', { class: 'im-row' }, [el('b', { class: 'im-grow', text: x.name }), unread ? el('span', { class: 'im-badge', text: String(unread) }) : null, x.artJob?.state === 'running' ? el('span', { class: 'im-spin', title: '그림 그리는 중' }) : null]),
              el('div', { class: 'im-muted', text: s?.status || '' }),
              last ? el('div', { class: 'im-muted', style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap', text: last.body.replace(/\s+/g, ' ') }) : null,
            ]);
          }) : [el('div', { class: 'im-muted', text: '편지 상대가 없습니다.' })]),
          el('div', { class: 'im-muted', style: 'margin-top:8px', text: '새 상대·설정·서류함은 서랍의 「우체통」 탭에 있어요.' }),
        );
      }
      panelRoot.replaceChildren(...[
        // 화면 가득 방식: 넓으면 왼쪽 목록이 페르소나·상대를 맡고, 좁으면(휴대폰) 위쪽 칩으로
        pageMode ? el('div', { class: 'im-page-chips' }, [personaChips(), mine.length ? people : null]) : personaChips(),
        !pageMode && mine.length ? people : null,
        tabs,
        ...body,
        P.error || S.error ? el('div', { class: 'im-err', text: P.error || S.error }) : null,
      ].filter(Boolean));
    },
  };
  views.add(panelView);

  // 편지첩: 오래된 편지부터 아래로, 맨 아래에 쓰기
  function bookView(c, act) {
    const now = Date.now();
    const exact = !!S.settings?.showExactEta;
    const nodes = c.letters.map((l) => {
      if (l.from === 'me') {
        if (l.state === 'in_transit') {
          return el('div', { class: 'im-transit im-mine' }, [
            el('div', { text: `내 편지가 가는 중 · ${etaLabel(l.arriveAt - now, exact)}` }),
            el('div', { text: short(l.body, 60) }),
            link('회수하기', () => act(async () => {
              if (!confirm('이 편지를 회수할까요? 상대에게 가지 않습니다.')) return;
              await ask('recall', { id: c.id, letterId: l.id });
              await refresh();
            })),
          ]);
        }
        const enc = l.enclosures?.length ? l.enclosures.map((x) => x.item) : (l.enclosure ? [l.enclosure] : []);
        return el('div', { class: 'im-paper im-mine' }, [
          el('div', { class: 'im-meta', text: `${l.personaName || '나'}의 편지 · ${when(l.sentAt)} 보냄 · 그쪽 ${l.theirArriveLabel} 도착` }),
          el('div', { text: l.body }),
          enc.length ? el('div', { class: 'im-encl' }, enc.map((x) => el('div', { text: `동봉 · ${x}` }))) : null,
        ]);
      }
      if (l.state === 'in_transit') return el('div', { class: 'im-transit im-theirs', text: `${c.name}의 편지가 ${exact ? etaLabel(l.arriveAt - now, true).replace('도착까지', '도착까지') : '어딘가를 건너는 중…'}` });
      return theirLetterNode(c, l, { act });
    });
    return [
      el('div', { class: 'im-muted', text: `${c.personaName ? `${c.personaName} ↔ ` : ''}${c.name} · 그쪽은 지금 ${c.theirNowLabel} · 1:${c.ratio}` }),
      artBar(c, act),
      c.reply?.state === 'failed' ? el('div', { class: 'im-row' }, [el('span', { class: 'im-err im-grow', text: `우편 사고: ${c.reply.error || ''}` }), btn('다시 시도', () => act(async () => { await ask('retry', { id: c.id }); await refresh(); }))]) : null,
      c.reply && c.reply.state !== 'failed' ? el('div', { class: 'im-transit im-theirs', text: `${c.name}이(가) 답장을 쓰고 있는 듯합니다` }) : null,
      ...(nodes.length ? nodes : [el('div', { class: 'im-muted', text: '아직 주고받은 편지가 없습니다. 첫 편지를 써 보세요.' })]),
      el('details', { open: !c.letters.length }, [
        el('summary', { class: 'im-muted', style: 'cursor:pointer', text: '편지 쓰기' }),
        composeBox(c, { busyRef: () => P.busy, act }),
      ]),
    ];
  }

  // 그림 작업 상태: 대상(편지지·우표·봉인·물건)마다 waiting/drawing/done/failed
  const artTarget = (c, kind, itemId = '') => (c?.artJob?.targets || []).find((t) => t.kind === kind && (t.itemId || '') === (itemId || '')) || null;
  const STATE_TEXT = { waiting: '기다리는 중', drawing: '그리는 중…', failed: '실패' };
  const stateOverlay = (t) => {
    if (!t || t.state === 'done') return null;
    return el('div', { class: `im-state${t.state === 'failed' ? ' im-bad' : ''}`, title: t.error || '' }, [
      t.state === 'drawing' ? el('span', { class: 'im-spin' }) : null,
      t.state === 'failed' ? `실패 — ${short(t.error || '', 40)}` : STATE_TEXT[t.state],
    ]);
  };
  // 그림 세트(편지지·우표·봉인) 상태와 버튼
  function artBar(c, act) {
    const have = ['paper', 'stamp', 'seal'].filter((k) => c.art?.[k]?.imageId);
    const job = c.artJob;
    const left = S.art?.left;
    if (job?.state === 'running') {
      const ts = job.targets || [];
      return el('div', { class: 'im-transit' }, [
        el('div', {}, [el('span', { class: 'im-spin' }), `그림을 그리는 중 ${job.done || 0}/${job.total}`]),
        ...ts.map((t) => el('div', { class: t.state === 'failed' ? 'im-err' : 'im-muted', text: `· ${t.label}: ${t.state === 'done' ? '완성' : STATE_TEXT[t.state] || t.state}${t.error && t.state === 'failed' ? ` (${short(t.error, 80)})` : ''}` })),
      ]);
    }
    const missing = ['paper', 'stamp', 'seal'].filter((k) => !have.includes(k));
    return el('div', {}, [
      job?.state === 'failed' ? el('div', { class: 'im-row' }, [
        el('span', { class: 'im-err im-grow', text: `지난 그리기 실패 ${(job.total || 0) - (job.done || 0)}장: ${short(job.error || '', 160)}` }),
        link('닫기', () => act(async () => { await ask('artDismiss', { id: c.id }); await refresh(); })),
      ]) : null,
      el('div', { class: 'im-row' }, [
        el('span', { class: 'im-muted im-grow', text: `그림 세트 ${have.length}/3${left !== undefined ? ` · 오늘 남은 그림 ${left}장` : ''}` }),
        link(missing.length ? `그림 세트 만들기(${missing.length}장)` : '세트 다시 그리기(3장)', () => act(async () => {
          const kinds = missing.length ? missing : ['paper', 'stamp', 'seal'];
          if (!confirm(`${c.name}의 ${kinds.map((k) => ({ paper: '편지지', stamp: '우표', seal: '봉인' })[k]).join('·')}을 그립니다.\n이미지 ${kinds.length}장 + 글 생성 1회. 계속할까요?`)) return;
          await ask('drawSet', { id: c.id, kinds });
          await refresh();
        })),
      ]),
    ]);
  }
  const drawItemBtn = (x, cid) => (x.imageId || (x.from === 'them' && x.state === 'in_transit') || !cid || ['waiting', 'drawing'].includes(artTarget(byId(cid), 'item', x.id)?.state) ? null
    : el('button', { class: 'im-link', type: 'button', text: artTarget(byId(cid), 'item', x.id)?.state === 'failed' ? '다시 그리기' : '그리기', style: 'font-size:11px', onclick: async (ev) => {
      ev.stopPropagation();
      if (!confirm(`「${x.name}」을 그립니다. 이미지 1장 + 글 생성 1회. 계속할까요?`)) return;
      try { await ask('drawItem', { id: cid, itemId: x.id }); await refresh(); } catch (e) { alert(e.message || String(e)); }
    } }));
  const itemCard = (x, who, cid) => el('div', { class: 'im-item', title: x.note || x.name }, [
    el('div', { class: 'im-pic' }, [x.imageId ? el('img', { src: imgUrl(x.imageId, 'lg'), alt: x.name, loading: 'lazy' }) : el('span', { html: PIC }), stateOverlay(artTarget(byId(cid), 'item', x.id))]),
    el('div', { class: 'im-cap' }, [
      el('b', { text: x.name }),
      x.note ? el('div', { class: 'im-muted', text: short(x.note, 60) }) : null,
      el('div', { class: 'im-muted', text: `${who} · ${x.state === 'in_transit' ? '가는 중' : `그쪽 ${x.theirLabel || ''}`}` }),
      drawItemBtn(x, cid),
    ]),
  ]);

  // 물품: 받은 것 / 보낸 것
  function itemsView(c) {
    const got = c.items.filter((x) => x.from === 'them');
    const gave = c.items.filter((x) => x.from === 'me');
    return [
      el('h4', { text: `받은 것 · ${got.length}` }),
      got.length ? el('div', { class: 'im-grid' }, got.slice().reverse().map((x) => itemCard(x, `${c.name}에게서`, c.id))) : el('div', { class: 'im-muted', text: '아직 받은 물건이 없습니다.' }),
      el('h4', { text: `보낸 것 · ${gave.length}` }),
      gave.length ? el('div', { class: 'im-grid' }, gave.slice().reverse().map((x) => itemCard(x, `${c.name}에게`, c.id))) : el('div', { class: 'im-muted', text: '편지를 쓸 때 「동봉할 것」에 적으면 여기에 남습니다.' }),
      el('div', { class: 'im-muted', text: '물건마다 「그리기」로 그림을 만들 수 있습니다(이미지 1장 + 글 1회). 설정에서 도착할 때 자동으로 그리게 할 수도 있습니다.' }),
    ];
  }

  // 모음: 페르소나의 모든 편지 묶음 + 모든 물품
  function albumView(list) {
    const items = list.flatMap((c) => c.items.filter((x) => x.state === 'arrived' || x.from === 'me').map((x) => ({ x, c })));
    items.sort((a, b) => (b.x.arriveAt || 0) - (a.x.arriveAt || 0));
    return [
      el('h4', { text: `편지 묶음 · ${list.length}` }),
      ...list.map((c) => {
        const ls = c.letters.filter((l) => !(l.from === 'them' && l.state === 'in_transit'));
        const first = ls[0];
        const last = ls[ls.length - 1];
        return el('div', { class: 'im-bundle', onclick: () => { P.id = c.id; P.tab = 'book'; lsSet(`${LS_PANEL}.id`, c.id); lsSet(`${LS_PANEL}.tab`, 'book'); panelView.render(); } }, [
          el('div', { class: 'im-stack' }, [el('i'), el('i'), el('i')]),
          el('div', { class: 'im-grow' }, [
            el('b', { text: c.name }),
            el('div', { class: 'im-muted', text: `${ls.length}통 · 물건 ${c.items.length}개${first ? ` · ${when(first.sentAt)} ~ ${when(last.sentAt)}` : ''}` }),
            el('div', { class: 'im-muted', text: c.personaName ? `${c.personaName}의 편지 상대` : '페르소나 없음' }),
          ]),
        ]);
      }),
      el('h4', { text: `모든 물건 · ${items.length}` }),
      items.length ? el('div', { class: 'im-grid' }, items.map(({ x, c }) => itemCard(x, x.from === 'me' ? `→ ${c.name}` : `${c.name} →`, c.id))) : el('div', { class: 'im-muted', text: '아직 오간 물건이 없습니다.' }),
    ];
  }

  // 우체통 위젯
  const box = el('div', { class: 'im-box', title: '이세계 우체통' });
  let lastDrag = 0;
  try {
    widget = ctx.ui.createFloatWidget({ width: 76, height: 96, initialPosition: { x: Math.max(12, window.innerWidth - 110), y: Math.max(12, window.innerHeight - 190) }, snapToEdge: false, tooltip: '이세계 우체통', chromeless: true });
    widget.root.append(box);
    if (!removeStyle) widget.root.append(el('style', { text: CSS }));
    // 끌기와 누르기 구분: 위치가 실제로 바뀐 끌기 직후의 클릭만 무시한다
    let downPos = null;
    widget.root.addEventListener('pointerdown', () => { downPos = widget.getPosition?.() || null; }, true);
    widget.onDragEnd?.((pos) => {
      if (!downPos || !pos || Math.abs(pos.x - downPos.x) + Math.abs(pos.y - downPos.y) > 4) lastDrag = Date.now();
    });
    widget.root.addEventListener('click', () => {
      if (Date.now() - lastDrag < 350) return;
      // 열 때 새 편지가 있으면 그 상대의 편지첩으로
      const fresh = panel?.isCollapsed() && S.all.find((c) => c.letters.some((l) => l.from === 'them' && l.state === 'delivered'));
      if (fresh) {
        if (!inPersona(fresh)) setPersona(ALL);
        openPanelFor(fresh.id);
      } else togglePanel();
    });
  } catch { widget = null; }

  let widgetKey = '';
  function renderWidget() {
    if (!widget) return;
    const unread = S.list.reduce((n, x) => n + x.unread, 0);
    const flagUp = unread > 0;
    const open = panel && !panel.isCollapsed();
    // 모양이 바뀔 때만 다시 그린다(누르는 도중에 그림이 바뀌어 클릭이 사라지지 않게)
    const running = S.all.filter((c) => c.artJob?.state === 'running').length;
    const failed = S.all.filter((c) => c.artJob?.state === 'failed').length;
    const key = `${unread}|${open}|${running}|${failed}`;
    if (key === widgetKey) return;
    widgetKey = key;
    // 고정 SVG(사용자 글 없음). 숫자만 textContent로 넣는다.
    box.innerHTML = `<svg width="76" height="96" viewBox="0 0 76 96" aria-hidden="true">
      <rect x="33" y="58" width="9" height="36" rx="1" fill="#6b5a48"/>
      <rect x="22" y="90" width="31" height="5" rx="2" fill="#4f4235"/>
      <path d="M8 34a22 22 0 0 1 44 0v26H8z" fill="#c8553a"/>
      <path d="M8 34a22 22 0 0 1 44 0" fill="none" stroke="#9e3d27" stroke-width="2"/>
      <rect x="8" y="50" width="44" height="10" fill="#b44a31"/>
      <rect x="15" y="38" width="30" height="5" rx="2.5" fill="#5a2516"/>
      <rect x="${open ? 50 : 53}" y="${flagUp ? 12 : 36}" width="3.5" height="${flagUp ? 30 : 8}" fill="#57524c"/>
      <path d="${flagUp ? 'M53.5 12h15l-3 5 3 5h-15z' : 'M53.5 36h4v14h-4z'}" fill="#f0a53a"/>
    </svg>`;
    if (unread) box.append(el('span', { text: String(unread), style: 'position:absolute;left:30px;top:4px;min-width:20px;height:20px;border-radius:10px;background:#534ab7;color:#fff;font:600 11px/20px system-ui,sans-serif;text-align:center;padding:0 5px;box-sizing:border-box' }));
    if (running) box.append(el('span', { class: 'im-pill', style: 'background:#7a5a2b', title: '그림을 그리는 중' }, [el('span', { class: 'im-spin', style: 'width:7px;height:7px;margin-right:3px' }), '그림']));
    else if (failed) box.append(el('span', { class: 'im-pill', style: 'background:#a33', title: '그림 그리기 실패 — 편지첩에서 확인' }, ['그림 실패']));
    box.style.position = 'relative';
    widget.root.title = [unread ? `새 편지 ${unread}통` : '이세계 우체통', running ? '그림 그리는 중' : '', failed ? '그림 실패 있음' : ''].filter(Boolean).join(' · ');
  }
  views.add({ render: renderWidget });

  const offActivate = tab.onActivate(() => refresh());
  const timer = setInterval(refresh, 60 * 1000);
  refresh();
  renderAll();

  return () => {
    clearInterval(timer);
    clearTimeout(soon);
    offActivate?.();
    offBack?.();
    removeStyle?.();
    widget?.destroy?.();
    panel?.destroy?.();
    tab.destroy();
  };
}
