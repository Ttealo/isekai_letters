import { paperLook, defaultTheme, PAPER_FONT_URL, PAPER_FONTS } from './paper.js';

// 편지첩 HTML(한 장짜리 책): 표지 → 차례 → 편지 → 기록부 → 모음 → 이어진 일들. 그림은 img(id, size)가 준 주소를 쓰고, 누르면 크게.
// 부수 효과 없음 — 그림 주소는 호출하는 쪽이 data URL로 바꿔 넣는다.
const exEsc = (t) => String(t ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const exDt = (ms, withTime = false) => (ms ? new Date(ms).toLocaleString('ko-KR', withTime ? { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' } : { year: 'numeric', month: 'long', day: 'numeric' }) : '');

export function buildLettersHtml(c, { img = () => '', myFaceId = '', myName = '', now = Date.now(), htmlPaper = true, me = null, myFont = '' } = {}) {
  const mf = PAPER_FONTS[myFont];
  const myStyle = mf ? ` style="font-family:'${mf.family}','Nanum Myeongjo',serif;font-size:${(15.5 * mf.size).toFixed(1)}px"` : '';
  const letters = (c.letters || []).filter((l) => !(l.from === 'them' && l.state === 'in_transit'));
  const itemsOf = (l) => (c.items || []).filter((x) => x.letterId === l.id && x.imageId);
  const pic = (id, size, alt, cls = '') => (id && img(id, size) ? `<img class="${cls}" src="${img(id, size)}" alt="${exEsc(alt)}" data-zoom="${exEsc(alt)}" loading="lazy">` : '');
  const envId = (l) => l.art?.envelope || c.art?.envelope?.imageId || '';
  const theirTitle = (l) => l.writtenLabel || l.theirWrittenLabel || '';
  const reports = c.reports || [];
  const rep = reports.at(-1);

  // ── 편지 ──
  const letterHtml = letters.map((l) => {
    const mine = l.from === 'me';
    const unread = !mine && l.state === 'delivered';
    const thumbs = unread ? '' : itemsOf(l).map((x) => `<figure class="thumb">${pic(x.imageId, 'lg', x.name)}<figcaption>${exEsc(x.name)}</figcaption></figure>`).join('');
    const enc = unread ? '' : (l.enclosures || []).map((x) => `<li>${exEsc(x.item)}${x.note ? ` — ${exEsc(x.note)}` : ''}</li>`).join('');
    const text = unread ? '<p class="unread">아직 열지 않은 편지</p>' : `<div class="text">${exEsc(l.body + (l.ps ? `\n\n추신. ${l.ps}` : ''))}</div>`;
    const divider = `<div class="divider"><span>${exEsc(exDt(mine ? l.sentAt : l.arriveAt))}${mine ? (l.theirArriveLabel ? ` · 그쪽 ${exEsc(l.theirArriveLabel)} 도착` : '') : (theirTitle(l) ? ` · 그쪽 ${exEsc(theirTitle(l))}` : '')}</span></div>`;
    if (mine) {
      return `${divider}<article class="letter mine"${myStyle}>${myFaceId ? pic(myFaceId, 'sm', '나', 'face') : ''}<div class="meta">${exEsc(l.personaName || myName || '나')}의 편지${l.late ? ` · 늦게 닿음(${exEsc(l.late)})` : ''}</div>${text}${enc ? `<ul class="encl">${enc}</ul>` : ''}${thumbs ? `<div class="thumbs">${thumbs}</div>` : ''}</article>`;
    }
    const e = l.envelope || {};
    const env = envId(l) ? `<details class="env"><summary>✉ 봉투 보기</summary>${pic(envId(l), 'lg', `${c.name}의 봉투`, 'envimg')}</details>` : '';
    const meta = `<div class="meta">${exEsc([`${c.name}의 편지`, e.medium, e.scent].filter(Boolean).join(' · '))}</div>`;
    const notes = [l.artNote && `✦ ${exEsc(l.artNote)}`, l.late && `✦ 우체부가 늦었다 — ${exEsc(l.late)}`, l.editedAt && '(고친 편지)'].filter(Boolean).map((x) => `<div class="note">${x}</div>`).join('');
    if (htmlPaper && !l.art?.paper) {
      const look = paperLook(l.theme || c.paperTheme || defaultTheme(c), { seed: l.id });
      return `${divider}${env}<article class="letter theirs themed" style="${exEsc(look.outer)}"><span class="corners">${look.corners}</span><div style="${exEsc(look.inner)}"><div class="meta" style="color:${look.metaColor}">${exEsc([`${c.name}의 편지`, e.medium, e.scent].filter(Boolean).join(' · '))}</div>${text}${enc ? `<ul class="encl" style="border-color:${look.accent}88">${enc}</ul>` : ''}${thumbs ? `<div class="thumbs">${thumbs}</div>` : ''}${notes}</div></article>`;
    }
    return `${divider}${env}<article class="letter theirs plain">${meta}${text}${enc ? `<ul class="encl">${enc}</ul>` : ''}${thumbs ? `<div class="thumbs">${thumbs}</div>` : ''}${notes}</article>`;
  }).join('\n');

  // ── 기록부 ──
  const voices = (r) => r.voices.map((v) => (v.hidden
    ? `<details class="voice secret"><summary>가려진 소문 — 눌러서 듣기</summary><p>“${exEsc(v.says)}”</p><div class="who">— ${exEsc(v.who)}${v.relation ? `, ${exEsc(v.relation)}` : ''}</div></details>`
    : `<div class="voice"><p>“${exEsc(v.says)}”</p><div class="who">— ${exEsc(v.who)}${v.relation ? `, ${exEsc(v.relation)}` : ''}</div></div>`)).join('');
  const reportHtml = rep ? `
<div class="record"><div class="rdate">${exEsc(exDt(rep.at))}의 기록</div>${rep.changed ? `<div class="changed">지난 기록 뒤로 — ${exEsc(rep.changed)}</div>` : ''}<div class="rnote">${exEsc(rep.note)}</div></div>
${rep.facts.length ? `<h3>알려진 것</h3><dl class="facts">${rep.facts.map((f) => `<dt>${exEsc(f.label)}</dt><dd>${exEsc(f.value)}</dd>`).join('')}</dl>` : ''}
${rep.voices.length ? `<h3>그쪽 사람들이 하는 말</h3><div class="voices">${voices(rep)}</div>` : ''}
${reports.length > 1 ? `<h3>지난 기록</h3>${reports.slice(0, -1).reverse().map((r) => `<details class="old"><summary>${exEsc(exDt(r.at))} · 「${exEsc(r.title)}」</summary><div class="rnote">${exEsc(r.note)}</div></details>`).join('')}` : ''}` : '<p class="empty">아직 받은 기록부가 없어요.</p>';

  // ── 모음 ──
  const fig = (id, cap, sub = '', cls = '') => (id && img(id, 'lg') ? `<figure class="${cls}">${pic(id, 'lg', cap)}<figcaption><b>${exEsc(cap)}</b>${sub ? `<small>${exEsc(sub)}</small>` : ''}</figcaption></figure>` : '');
  const portraits = [...(c.art?.portrait ? [{ ...c.art.portrait, now: true }] : []), ...[...(c.art?.portraitHistory || [])].reverse()];
  const drawn = (c.items || []).filter((x) => x.imageId && (x.nai || x.photo) && x.state !== 'in_transit');
  const things = (c.items || []).filter((x) => x.imageId && !x.nai && !x.photo && x.state !== 'in_transit');
  const envs = letters.filter((l) => l.from === 'them' && envId(l) && l.state !== 'delivered');
  const block = (title, inner) => (inner ? `<h3>${title}</h3>${inner}` : '');
  const albumHtml = [
    c.art?.locker?.imageId ? `<div class="box">${pic(c.art.locker.imageId, 'lg', '추억 상자')}</div>` : '',
    block(`초상화 · ${portraits.length}`, portraits.length ? `<div class="grid tall">${portraits.map((p) => fig(p.imageId, p.now ? '지금 모습' : '예전 모습', exDt(p.at))).join('')}</div>` : ''),
    block(`그림·사진 · ${drawn.length}`, drawn.length ? `<div class="grid">${drawn.map((x) => fig(x.imageId, x.name, x.from === 'me' ? '내가 보냄' : `${c.name}이(가) 보냄`)).join('')}</div>` : ''),
    block(`봉투 · ${envs.length}`, envs.length ? `<div class="grid wide">${envs.map((l) => fig(envId(l), theirTitle(l) || exDt(l.arriveAt))).join('')}</div>` : ''),
    block(`물건 · ${things.length}`, things.length ? `<div class="grid">${things.map((x) => fig(x.imageId, x.name, [x.note, x.from === 'me' ? '내가 보냄' : `${c.name}이(가) 보냄`].filter(Boolean).join(' · '))).join('')}</div>` : ''),
  ].join('\n');

  // ── 이어진 일들 ──
  const tl = letters.map((l) => ({ t: l.from === 'me' ? l.sentAt : l.arriveAt, cls: l.from === 'me' ? 'me' : 'them', text: l.from === 'me' ? '내가 편지를 보냄' : `${c.name}의 편지가 닿음${l.enclosures?.length ? ` · 동봉 ${l.enclosures.map((x) => x.item).join(', ')}` : ''}`, when: l.from === 'me' ? l.theirSentLabel : theirTitle(l) }));
  const ev = (c.memory?.timeline || []);
  const tlHtml = `<ol class="tl">${tl.map((x) => `<li class="${x.cls}"><span class="when">${exEsc(exDt(x.t))}${x.when ? ` · 그쪽 ${exEsc(x.when)}` : ''}</span>${exEsc(x.text)}</li>`).join('')}</ol>
${ev.length ? `<h3>그쪽 연대기</h3><ol class="tl">${ev.map((e) => (e.open ? `<li class="event"><span class="when">${exEsc(e.when || '')}</span>${exEsc(e.event)}</li>` : `<li class="secret"><span class="when">${exEsc(e.when || '')}</span><details><summary>편지에 쓰지 않은 그쪽의 일</summary>${exEsc(e.event)}</details></li>`)).join('')}</ol>` : ''}`;

  // ── 나(페르소나) ──
  const meHtml = (() => {
    if (!me && !myFaceId && !myName) return '';
    const hist = (me?.history || []).slice().reverse();
    const faceBig = me?.portraitId || myFaceId;
    return `<div class="mebox">
${faceBig ? pic(faceBig, 'lg', `${myName || '나'} 초상화`, 'meface') : ''}
<div class="meinfo"><div class="mename">${exEsc(myName || '나')}</div>${me?.title ? `<div class="metitle">${exEsc(me.title)}</div>` : ''}${me?.noPersona ? '<div class="metitle">페르소나 없이, 이 세계의 나 자신으로</div>' : ''}
${me?.description ? `<div class="medesc">${exEsc(me.description)}</div>` : ''}
<div class="mestats">${exEsc(c.name)}에게 보낸 편지 ${letters.filter((l) => l.from === 'me').length}통 · 보낸 물건·사진 ${(c.items || []).filter((x) => x.from === 'me').length}개</div></div></div>
${hist.length ? `<h3>지난 모습 · ${hist.length}</h3><div class="grid tall">${hist.map((h) => fig(h.imageId, '예전 모습', exDt(h.at))).join('')}</div>` : ''}`;
  })();
  const first = letters[0]?.sentAt; const last = letters.at(-1)?.sentAt;
  const emb = c.art?.emblem?.imageId || c.art?.seal?.imageId;
  const sections = [['letters', '편지', letterHtml || '<p class="empty">아직 주고받은 편지가 없어요.</p>'], ['record', '기록부', reportHtml], ...(meHtml ? [['me', '나', meHtml]] : []), ['album', '모음', albumHtml || '<p class="empty">아직 모인 그림이 없어요.</p>'], ['timeline', '이어진 일들', tlHtml]];
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${exEsc(c.name)} — 이세계 우체통 편지첩</title>
<link rel="stylesheet" href="${PAPER_FONT_URL}">
<style>
*{box-sizing:border-box}
body{margin:0;background:#ebe3d3;background-image:radial-gradient(#dccfb6 1px,transparent 1px);background-size:18px 18px;color:#3b2f22;font-family:"Gowun Batang","Nanum Myeongjo","Noto Serif KR",Georgia,serif}
main{max-width:780px;margin:0 auto;padding:36px 18px 90px}
.cover{display:grid;grid-template-columns:auto 1fr;gap:22px;align-items:center;background:#f7f1e4;border-radius:10px;padding:24px;box-shadow:0 14px 30px -18px #0009}
.cover .faces{position:relative;width:170px;height:200px}
.cover .portrait{position:absolute;left:0;top:0;width:140px;aspect-ratio:832/1216;object-fit:cover;border:6px solid #fff;box-shadow:0 8px 18px -10px #0008;transform:rotate(-3deg)}
.cover .emblem{position:absolute;right:0;bottom:0;width:78px;height:78px;border-radius:50%;object-fit:cover;background:#f6efe2;box-shadow:0 0 0 3px #fff,0 6px 14px -6px #0008}
h1{margin:0;font-size:32px;letter-spacing:.02em}
.ctitle{font-size:17px;margin:6px 0 10px;color:#6b4e2a}
.stats{font:13px/1.7 system-ui,sans-serif;color:#7a6a52}
.me{display:flex;align-items:center;gap:8px;margin-top:10px;font:13px system-ui,sans-serif;color:#5d6b78}
.me img{width:30px;height:30px;border-radius:50%;object-fit:cover;object-position:50% 15%}
nav{position:sticky;top:0;z-index:5;display:flex;gap:6px;justify-content:center;margin:22px 0 8px;padding:8px;background:#ebe3d3e6;backdrop-filter:blur(4px)}
nav a{font:14px system-ui,sans-serif;color:#3b2f22;text-decoration:none;padding:6px 14px;border-radius:999px;background:#fff8}
nav a:hover{background:#fff}
section{scroll-margin-top:60px}
h2{font-size:22px;margin:40px 0 14px;display:flex;align-items:center;gap:10px}
h2::after{content:"";flex:1;height:1px;background:#c9b38c}
h3{font-size:16px;margin:26px 0 10px;color:#6b4e2a}
.divider{text-align:center;margin:28px 0 10px;font:12px system-ui,sans-serif;color:#8a7458}
.divider span{background:#ebe3d3;padding:0 10px}
.letter{position:relative;white-space:normal}
.letter .text{white-space:pre-wrap}
.letter.mine,.letter.plain{background:#eef1f4;color:#26313b;border:1px solid #c5ced8;border-radius:4px;padding:20px 22px;margin-left:8%;background-image:repeating-linear-gradient(transparent 0 29px,#b8c4d055 29px 30px);line-height:30px;font-size:15.5px;box-shadow:0 10px 22px -14px #0007}
.letter.plain{background:#f4ead6;color:#3b2f22;border-color:#d6c3a0;margin:0 8% 0 0;background-image:repeating-linear-gradient(transparent 0 29px,#d9c7a455 29px 30px)}
.letter.themed{margin-right:8%}
.letter .corners{position:absolute;inset:0;pointer-events:none}
.letter .face{float:right;width:44px;height:44px;border-radius:50%;object-fit:cover;object-position:50% 15%;margin:0 0 6px 10px;box-shadow:0 2px 6px #0004}
.meta{font:12px/1.5 system-ui,sans-serif;color:#7a6a52;margin-bottom:8px;white-space:normal}
.unread{font-style:italic;color:#8a7458}
.encl{margin:12px 0 0;padding:8px 0 0 18px;border-top:1px dashed #c9b38c;font-size:.92em}
.note{font:12px system-ui,sans-serif;color:#a8322a;margin-top:8px}
.thumbs{display:flex;flex-wrap:wrap;gap:12px;margin-top:14px}
.thumb{margin:0;width:130px;background:#fffd;padding:5px;box-shadow:0 4px 10px -6px #0008;transform:rotate(-1deg)}
.thumb:nth-child(even){transform:rotate(1.2deg)}
.thumb img{width:100%;aspect-ratio:1;object-fit:cover;display:block}
.thumb figcaption{font:11px/1.3 system-ui,sans-serif;color:#555;text-align:center;padding-top:4px}
.env{margin:0 8% 8px 0;font:13px system-ui,sans-serif;color:#6b4e2a}
.env summary{cursor:pointer}
.env .envimg{display:block;width:100%;max-width:520px;margin:8px 0;border-radius:6px;box-shadow:0 8px 20px -12px #0008}
.record{background:#f7f1e4;border-radius:6px;padding:22px 24px;box-shadow:0 10px 22px -16px #0008;background-image:repeating-linear-gradient(transparent 0 29px,#d9c7a440 29px 30px)}
.rdate{font:12px system-ui,sans-serif;color:#8a7458;margin-bottom:6px}
.changed{font-family:"Nanum Pen Script",cursive;font-size:20px;color:#a8322a;margin-bottom:6px}
.rnote{white-space:pre-wrap;font-size:15.5px;line-height:30px}
.facts{display:grid;grid-template-columns:max-content 1fr;gap:6px 16px;font-size:14px}
.facts dt{color:#8a7458}.facts dd{margin:0}
.voices{display:flex;flex-direction:column;gap:10px}
.voice{background:#fff8;border-left:3px solid #c9b38c;padding:10px 14px;border-radius:0 8px 8px 0}
.voice p{margin:0;line-height:1.75}
.voice .who{font:12px system-ui,sans-serif;color:#8a7458;text-align:right;margin-top:4px}
.voice.secret{border-left-color:#7d2019}
.voice.secret summary{cursor:pointer;font-style:italic;color:#8a7458}
details.old{margin:6px 0}details.old summary{cursor:pointer;font:13px system-ui,sans-serif;color:#8a7458}
.box{max-width:380px;margin:0 auto 10px}.box img{width:100%;display:block;border-radius:12px;background:#fff;box-shadow:0 10px 24px -14px #0008}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:14px}
.grid.wide{grid-template-columns:repeat(auto-fill,minmax(230px,1fr))}
.grid figure{margin:0;background:#fbf6ec;padding:7px;box-shadow:0 6px 14px -10px #0008}
.grid img{width:100%;aspect-ratio:1;object-fit:cover;display:block}
.grid.tall img{aspect-ratio:832/1216}.grid.wide img{aspect-ratio:3/2}
.grid figcaption{font:12.5px/1.45 system-ui,sans-serif;padding:6px 2px 0}.grid figcaption small{display:block;color:#8a7458}
.tl{list-style:none;margin:0;padding:0 0 0 18px;border-left:2px solid #c9b38c}
.tl li{position:relative;margin:0 0 12px;font-size:14px}
.tl li::before{content:"";position:absolute;left:-25px;top:6px;width:10px;height:10px;border-radius:50%;background:#c9b38c}
.tl li.them::before{background:#8a5a2b}.tl li.me::before{background:#3d6c8f}.tl li.event::before{background:#5f7d3a}.tl li.secret::before{background:#7d2019}
.tl .when{display:block;font:11.5px system-ui,sans-serif;color:#8a7458}
.tl summary{cursor:pointer;font-style:italic;color:#8a7458}
.empty{color:#8a7458;font-style:italic}
.mebox{display:grid;grid-template-columns:auto 1fr;gap:20px;align-items:start;background:#eef1f4;border-radius:10px;padding:20px;box-shadow:0 10px 22px -16px #0008;color:#26313b}
.meface{width:150px;aspect-ratio:832/1216;object-fit:cover;border:5px solid #fff;box-shadow:0 8px 18px -10px #0008;transform:rotate(2deg)}
.mename{font-size:22px;font-weight:700}.metitle{font:13px system-ui,sans-serif;color:#5d6b78;margin:2px 0 8px}
.medesc{white-space:pre-wrap;font-size:14.5px;line-height:1.8;margin:6px 0}.mestats{font:12.5px system-ui,sans-serif;color:#5d6b78;margin-top:8px}
@media (max-width:560px){.mebox{grid-template-columns:1fr}}
img[data-zoom]{cursor:zoom-in}
#zoom{position:fixed;inset:0;background:#000c;display:none;align-items:center;justify-content:center;flex-direction:column;gap:10px;z-index:9;cursor:zoom-out;padding:20px}
#zoom img{max-width:94vw;max-height:84vh;border-radius:6px}#zoom div{color:#f3ead8;font:13px system-ui,sans-serif}
footer{margin-top:60px;text-align:center;font:12px system-ui,sans-serif;color:#9a8a70}
@media (max-width:560px){.cover{grid-template-columns:1fr}.letter.mine,.letter.plain,.letter.themed,.env{margin-left:0;margin-right:0}}
@media print{nav,#zoom{display:none}body{background:#fff}.letter{break-inside:avoid}}
</style></head><body><main>
<header class="cover">
<div class="faces">${c.art?.portrait?.imageId ? pic(c.art.portrait.imageId, 'lg', `${c.name} 초상화`, 'portrait') : ''}${emb ? pic(emb, 'lg', `${c.name} 상징물`, 'emblem') : ''}</div>
<div><h1>${exEsc(c.name)}</h1>${rep ? `<div class="ctitle">「${exEsc(rep.title)}」</div>` : ''}
<div class="stats">편지 ${letters.length}통${first ? ` · ${exEsc(exDt(first))} ~ ${exEsc(exDt(last))}` : ''}<br>그쪽 시간 1:${exEsc(c.ratio)}${c.mail?.medium ? ` · 편지: ${exEsc(c.mail.medium)}` : ''}${c.theirNowLabel ? `<br>그쪽은 지금 ${exEsc(c.theirNowLabel)}` : ''}</div>
${myFaceId || myName ? `<div class="me">${myFaceId ? pic(myFaceId, 'sm', '나') : ''}<span>${exEsc(myName || '나')}의 편지 상대</span></div>` : ''}</div>
</header>
<nav>${sections.map(([k, t]) => `<a href="#${k}">${t}</a>`).join('')}</nav>
${sections.map(([k, t, h]) => `<section id="${k}"><h2>${t}</h2>${h}</section>`).join('\n')}
<footer>이세계 우체통 · ${exEsc(exDt(now, true))} 저장</footer>
</main>
<div id="zoom"><img alt=""><div></div></div>
<script>
const z=document.getElementById('zoom');
document.addEventListener('click',(e)=>{const t=e.target;if(t.matches&&t.matches('img[data-zoom]')){z.querySelector('img').src=t.src;z.querySelector('div').textContent=t.dataset.zoom||'';z.style.display='flex';}else if(z.contains(t)){z.style.display='none';}});
</script>
</body></html>`;
}
