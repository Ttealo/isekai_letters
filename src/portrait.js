// 캐릭터 초상화(NovelAI V4.5 Full): 카드 → 글 생성이 NAI 태그 프롬프트를 쓰고, 사용자 화풍 프롬프트와 합친다. 부수 효과 없음.
// 작성 규칙은 사용자 지침 D:\소스\캐릭터챗\11_더스트블러드\NovelAI_Prompt_Guide_v3.md 의 V4.5F 부분을 줄인 것.

// 사용자가 준 기본 화풍·품질 프롬프트(인원 태그 1man, solo는 캐릭터 쪽이 정하므로 뺐다)
export const NAI_BASE = [
  '2.0:: thick_lineart, sharp_focus ::,',
  '1.5::detailed eyes, beautiful eyes, perfect eyes::, 1.2::perfect anatomy, perfect hands::, masterpiece, best quality, very aesthetic, highres, year 2025, year 2024, ultra-detailed,',
  '1.5::artist:ramsrar::,',
  '1.0::artist:muksal::,',
  '0.7::artist:mery (yangmalgage)::,',
  '0.4::artist:soybean_(hisoybean)::, 0.5::artist:qianben shan::, 0.8::artist:nidexintu::, 0.9::artist:mgmg_1012 ::, 0.5::artist:yoggi (stretchmen)::,',
  '0.7::artist:96yottea, artist:nano_(c175311) ::,',
  '1.4::artist:lack, artist:bikkusama::,',
  '1.2::perfect anatomy::,-3::simple illustration::, -1::censored::, -3::flat color ::, -3::monochrome ::, -2::artist collaboration ::, -3::Unfinished Eyes::, scenely, -2::lips::, depth of field, bokeh,',
].join('\n');

export const NAI_NEGATIVE = [
  'text, logo, signature, watermark, too many watermarks,',
  '0.4::artist:nameo (judgemasterkou), artist:matsunaga kouyou::, artist collaboration,',
  'chibi, 1990s (style), anatomical structure error,',
  'bad anatomy, distorted anatomy, disfigured, bad hands, missing finger, extra digits, mutation, extra arms, extra legs, long neck, bad feet, very displeasing, undetailed eyes, asymmetrical face, fused eyes, bad eyes, disfigured eyes, mutated eyes,',
  'multiple views, negative space, blank page,',
  'variant set, large variant set, 4koma, 2koma, oekaki,',
  'halftone, screentone, artistic error, film grain, scan artifacts, jpeg artifacts, chromatic aberration, dithering, disorganized colors,',
  'lowres, worst quality, bad quality, cheesy, sloppiness, unfinished, Incomplete, Realistic Art Style, 3::multiple views::, 5::Unfinished Eyes::, 6::artist name::,',
].join('\n');

export const DEFAULT_PORTRAIT = {
  connectionId: '', // NovelAI 이미지 연결(필수)
  model: 'nai-diffusion-4-5-full',
  base: NAI_BASE,
  negative: NAI_NEGATIVE,
  size: '832x1216',
  avatar: true, // 매칭으로 만든 캐릭터의 아바타로 쓰기
  avatarExisting: false, // 원래 있던 캐릭터(기존 캐릭터로 시작)도 아바타를 바꿀지
};

const pstr = (v, max, d = '') => (typeof v === 'string' ? v.trim().slice(0, max) : d);
export function cleanPortrait(p) {
  return {
    connectionId: pstr(p?.connectionId, 200),
    model: pstr(p?.model, 200) || DEFAULT_PORTRAIT.model,
    base: pstr(p?.base, 4000) || NAI_BASE,
    negative: pstr(p?.negative, 4000) || NAI_NEGATIVE,
    size: typeof p?.size === 'string' && /^\d{3,4}x\d{3,4}$/.test(p.size.trim()) ? p.size.trim() : DEFAULT_PORTRAIT.size,
    avatar: p?.avatar !== false,
    avatarExisting: !!p?.avatarExisting,
  };
}

const NAI_GUIDE = `
<nai_v45f_rules>
Target: NovelAI Diffusion V4.5 Full. English only (the tokenizer ignores Korean/Japanese/emoji). Lowercase known Danbooru-style tags, comma separated; short English phrases only where no tag exists. Never invent fake compound tags.
Prompts are blueprints, not impressions: state what, where, which direction, length, shape, material, pattern, motif. Convert moods into visible attributes. Never write "looks like", "mysterious", "elegant aura" etc.
Allowed fixed evaluative phrases (closed list): elegant jawline, refined nose, refined nose bridge, graceful eyebrows, large delicate eyes, gentle droopy eyes.
No synonyms repeated (not "black hair, jet black hair"). Precision = number of independent attributes, not repetition.
Weights sparingly (at most 3 in total), format 1.2::tag:: and always close with ::. Negative weights only for targeted removal.

character (fixed appearance only — no emotion, action, background, time, lighting, scene props), in this order:
1. subject: 1boy / 1girl / 1other, solo. Non-human: add known species tags (e.g. animal ears, tail, horns, pointy ears, scales, monster girl, monster boy, robot joints, ghost, slime girl, plant girl, furry male/female); if barely humanoid, describe the body structure with short phrases.
2. age impression: adults only. Male 25+: 2::mature male::, 1::aged up::. Female: mature female when needed. Never add childlike traits. bishounen only if the card says beautiful male.
3. build: tags first (skinny / slim / toned / muscular / curvy / plump / tall / petite / broad shoulders / narrow waist); never both sides of a conflict.
4. skin: color, brightness, surface, marks (e.g. pale skin, smooth skin, freckles, scar on cheek).
5. face line: one base phrase with 1.2:: (balanced facial proportions / sophisticated facial features / aristocratic facial features / delicate facial features / strong masculine facial structure / sculpted facial features / soft facial features) + 3~5 part phrases that distinguish this person (elongated face / soft oval face / soft rounded face / defined jawline / sharp jawline / broad chin / small chin / prominent cheekbones / straight nose / small nose / tsurime / tareme / jitome / half-closed eyes / narrow sharp eyes / almond eyes / deep-set eyes / downturned outer corners / thick eyebrows / straight eyebrows / thin lips / mole under eye). tsurime and tareme never together. No smile here.
6. hair — fill all slots: color (exactly one tag), length, texture (straight/wavy/curly/messy/spiked hair), bangs (e.g. blunt bangs, swept bangs, center-parted bangs, no bangs = hair pulled back / forehead), sidelocks, back/tie (ponytail, braid, bun…), top/ornament (ahoge, hair ornament…). Use the plainest value if the card is silent.
7. eyes: color tag + irises/pupils (e.g. clear glossy irises, slit pupils), heterochromia only if stated.
8. clothing: type → material → color → structure → length → trim → pattern → decoration, plus fit (tailored fitted silhouette / loose draped silhouette / structured stiff silhouette …). Base it on their job and world. Not one vague word like "fantasy outfit".
9. accessories that identify them: type, position, material, color, motif.
Keep character under ~180 tokens.

scene (one portrait, base prompt part): framing (upper body or cowboy shot), a simple pose that fits them (e.g. holding a letter, sitting at a desk with a pen), a calm expression tag that suits their temperament, 3~6 background tags of their world, 1~2 lighting tags. Under ~70 tokens.
character_uc: only opposite drifts to block (e.g. mature adult → youthful facial features, baby face; man drawn feminine → feminine face; slim → muscular, abs). Often empty. Never a generic quality list.
</nai_v45f_rules>`;

export function buildPortraitMessages(c, { cardText = '', world = '' } = {}) {
  const system = [
    'You write NovelAI image prompts from character sheets. Follow the rules exactly and keep every fact the sheet gives (hair, eyes, build, clothing, species, scars). Do not add designs the sheet contradicts; fill silent slots with plain values.',
    NAI_GUIDE,
  ].join('\n');
  const user = [
    `<character_sheet name="${c.name}">`,
    cardText || c.brief || '',
    '</character_sheet>',
    world ? `<world>\n${world.slice(0, 1500)}\n</world>` : '',
    c.mail?.imageKeywords?.length ? `world_visual_keywords=${c.mail.imageKeywords.join(', ')}` : '',
    'The sheet is in Korean; translate attributes into English tags.',
    'Output JSON only: {"character":"","scene":"","character_uc":""}',
  ].filter(Boolean).join('\n');
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

// 한글·이모지는 빼고(인식 못 함), 줄바꿈은 쉼표 띄어쓰기로
const naiClean = (v, max) => pstr(typeof v === 'string' ? v : '', max)
  .replace(/[\u3131-\uD79D\u3040-\u30FF\u4E00-\u9FFF]+/g, '')
  .replace(/\p{Extended_Pictographic}/gu, '')
  .replace(/\s*\n+\s*/g, ' ')
  .replace(/[ \t]{2,}/g, ' ')
  .replace(/\s+,/g, ',')
  .replace(/,\s*,+/g, ',')
  .trim();

export function cleanPortraitPrompt(raw) {
  const character = naiClean(raw?.character, 1500);
  if (!character) throw new Error('초상화 캐릭터 프롬프트가 비어 있습니다.');
  return { character, scene: naiClean(raw?.scene, 800), characterUc: naiClean(raw?.character_uc, 400) };
}

// 최종 요청: 기본(화풍·품질) + 장면 = base prompt, 캐릭터는 character prompt 칸, 금지어 + 캐릭터 UC
export function composePortrait(P, pp) {
  const flat = (t) => String(t || '').replace(/\s*\n+\s*/g, ' ').trim();
  const base = flat(P.base).replace(/,\s*$/, '');
  return {
    prompt: [base, pp.scene].filter(Boolean).join(', '),
    negative: [flat(P.negative).replace(/,\s*$/, ''), pp.characterUc].filter(Boolean).join(', '),
    characterTags: [{ tags: pp.character }],
  };
}
