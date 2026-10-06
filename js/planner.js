'use strict';
// 한 주 식단: 고른 주(일~토)의 요일·끼니에 한꺼번에 넣기
//  - 랜덤 추천: 밥·국·반찬(1~3개)·메인·간식·디저트를 켜고 끈 조합으로, 같은 주에는 되도록 안 겹치게. 메뉴를 누르면 그것만 다시 뽑기
//    제철 재료 우선: 그 달 제철 재료(menu-presets.js SEASON_PRESETS, 고치면 계정에 저장)가 들어간 메뉴부터
//  - 테마 추천: 고른 태그(메뉴 편집 › 태그, 예: #계절 #손님초대)가 붙은 메뉴에서 하루 1~3개 (종류·분류 상관없이)
//  - 직접 고르기: 적은 메뉴를 고른 요일마다 (예: 아침 요거트)
// 이미 그 끼니에 같은 메뉴가 있으면 건너뜀. meals.js 의 menus, pushMeal, mealsOn 등을 그대로 사용

// 추천 칸마다 고르는 곳: 한식(종류가 비어 있어도)의 분류 › 하위분류.
// home이 있으면 그 기본 그룹이 지금 있는 종류 전부 (예: 디저트를 간식·디저트로 바꿨으면 간식·디저트)
const PARTS = [
  { key: 'rice', label: '밥', course: '밥·면', subs: ['밥'] },
  { key: 'soup', label: '국', course: '국', subs: ['국', '찌개'] },
  { key: 'side', label: '반찬', course: '반찬', subs: ['볶음', '무침', '나물', '기타'] },
  { key: 'main', label: '메인', course: '메인', subs: ['구이', '볶음', '찜', '조림'] },
  { key: 'dessert', label: '간식·디저트', home: ['디저트'] },
];
// 테마 추천 칸: 고른 태그가 붙은 메뉴 아무거나
const THEME = { key: 'theme', label: '테마' };
const multi = p => p.key === 'side' || p === THEME; // 하루에 여러 개 뽑는 칸 (3개까지 뽑아 두고 보이는 개수만 씀)
// 기기별 설정 (끼니는 방식마다 따로: 추천은 보통 저녁, 직접은 보통 아침)
const plan = () => ({
  mode: 'random', slots: { random: 'd', theme: 'd', pick: 'b' }, parts: { rice: true, soup: true, side: true, main: true, dessert: false },
  sides: 2, season: false, pick: [], theme: null, themeN: 2, ...prefs.plan,
});
const slotOf = o => o.slots[o.mode] || 'd'; // 예전 설정에는 테마 끼니가 없음
// 테마로 고를 수 있는 태그 (메뉴에 붙은 것). 고른 태그가 없어졌으면 첫 번째
const themeTags = () => [...new Set(menus().flatMap(tagsOf))].sort(ranker(TAG_PRESETS));
const themeOf = o => { const t = themeTags(); return t.includes(o.theme) ? o.theme : t[0] || null; };
function setPlan(patch) {
  prefs.plan = { ...plan(), ...patch };
  savePrefs();
}

let planWeek = 0;  // 그 주 일요일 (일 번호)
let planDays = []; // 넣을 요일 7개 (true/false)
let picks = [];    // 요일별 추천 { rice, soup, side: [3개], main, dessert, theme: [3개] } — 메뉴 또는 null

// ---------- 제철 ----------
const seasonMonth = () => ymd(toStr(planWeek + 3))[1]; // 그 주 수요일의 달
const seasonId = m => `season-${m}`; // 달마다 한 줄 (id가 같아서 기기끼리 겹치지 않음)
function seasonWords(m) {
  const r = recs('season').find(x => x.id === seasonId(m));
  return r ? r.items : SEASON_PRESETS[m].split(',').map(s => s.trim());
}
// 한 글자는 그 글자로 시작할 때만 ('무' → 무말랭이, 무침은 아님). 더 긴 제철 재료로 시작하면 아님 ('배' → 배추김치는 아님)
const LONG_SEASON = [...new Set(Object.values(SEASON_PRESETS).flatMap(v => v.split(',').map(s => norm(s.trim()))))].filter(w => w.length > 1);
const hit = (s, w) => w.length > 1 ? s.includes(w) : s.startsWith(w) && !LONG_SEASON.some(l => l.startsWith(w) && s.startsWith(l));
function seasonal(x) {
  const ws = seasonWords(seasonMonth()).map(norm);
  return ws.some(w => hit(norm(x.name), w) || (x.ingredients || []).some(g => hit(norm(g), w)));
}

// ---------- 뽑기 ----------
const inPart = (p, x) => (x.cuisine || '한식') === '한식' && x.course === p.course && p.subs.includes(x.sub || '');
const usedIn = key => picks.flatMap(d => [].concat(d[key])).filter(Boolean);
const shuffle = a => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
// 이번 주에 안 쓴 것 중에서 (다 썼으면 아무거나), 제철 우선이면 제철인 것 먼저 (랜덤 추천만). avoid는 빼고
function draw(p, avoid) {
  const tag = p === THEME ? themeOf(plan()) : null, home = p.home ? presetHome(p.home) || p.home : null;
  const ok = p === THEME ? x => !!tag && tagsOf(x).includes(tag) : home ? x => startsWith(pathOf(x), home) : x => inPart(p, x);
  const all = menus().filter(x => ok(x) && !avoid.includes(x)), used = usedIn(p.key);
  let c = all.filter(x => !used.includes(x));
  if (!c.length) c = all;
  if (plan().season && p !== THEME) {
    const s = c.filter(seasonal);
    if (s.length) c = s;
  }
  return c.length ? c[Math.floor(Math.random() * c.length)] : null;
}
function rollAll() {
  picks = Array.from({ length: 7 }, () => ({ rice: null, soup: null, side: [null, null, null], main: null, dessert: null, theme: [null, null, null] }));
  // 켠 요일 먼저, 순서는 섞어서 뽑기 (제철 메뉴가 앞 요일이나 끈 요일에 몰리지 않게)
  const days = [0, 1, 2, 3, 4, 5, 6];
  for (const i of [...shuffle(days.filter(i => planDays[i])), ...days.filter(i => !planDays[i])]) {
    for (const p of [...PARTS, THEME]) {
      if (multi(p)) for (let k = 0; k < 3; k++) picks[i][p.key][k] = draw(p, picks[i][p.key]);
      else picks[i][p.key] = draw(p, []);
    }
  }
}
function reroll(i, p, k) {
  const d = picks[i];
  const x = draw(p, multi(p) ? d[p.key] : [d[p.key]]);
  if (!x) return;
  if (multi(p)) d[p.key][k] = x; else d[p.key] = x;
  renderPlan();
}
// 그날 넣을 메뉴 (랜덤: 켜 둔 칸만 밥·국·반찬·메인 순, 테마: 하루 개수만큼)
function dayMenus(i) {
  const o = plan(), d = picks[i];
  if (o.mode === 'theme') return d.theme.slice(0, o.themeN).filter(Boolean);
  return PARTS.filter(p => o.parts[p.key]).flatMap(p => p.key === 'side' ? d.side.slice(0, o.sides) : [d[p.key]]).filter(Boolean);
}

// ---------- 창 ----------
function setWeek(n) {
  planWeek = n;
  const today = toNum(todayStr());
  planDays = Array.from({ length: 7 }, (_, i) => n + i >= today); // 지난 날은 처음엔 끔
  rollAll();
  renderPlan();
}
function renderPlan() {
  const o = plan(), mode = o.mode, tag = themeOf(o);
  $('planTitle').textContent = `${fmtMD(toStr(planWeek))}(일) ~ ${fmtMD(toStr(planWeek + 6))}(토)`;
  $('planDays').replaceChildren(...WD.map((w, i) => button(w, () => { planDays[i] = !planDays[i]; renderPlan(); }, planDays[i] ? 'on' : '')));
  document.querySelectorAll('#planSlot [data-slot]').forEach(b => b.classList.toggle('on', b.dataset.slot === slotOf(o)));
  document.querySelectorAll('#planMode [data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
  $('planRandom').hidden = mode !== 'random';
  $('planTheme').hidden = mode !== 'theme';
  $('planDraw').hidden = mode === 'pick' || (mode === 'theme' && !tag);
  $('planReroll').hidden = mode === 'pick';
  $('planPick').hidden = mode !== 'pick';
  $('planRemove').hidden = mode !== 'pick';
  if (mode === 'pick') {
    $('planChosen').replaceChildren(...o.pick.map(name => {
      const b = button(`${name} ✕`, () => setPick(o.pick.filter(x => x !== name)), 'on');
      b.title = '빼기';
      return b;
    }));
    return;
  }
  if (mode === 'theme') {
    const tags = themeTags();
    $('planThemeTags').replaceChildren(...(tags.length ? tags.map(t => button(`#${t}`, () => {
      setPlan({ theme: t });
      rollAll();
      renderPlan();
    }, t === tag ? 'on' : '')) : [h('span', 'hint', '메뉴에 태그를 붙이면 (메뉴 편집 › 태그, 예: #계절 #손님초대) 그 태그 메뉴로 추천해요')]));
    document.querySelectorAll('#planThemeN [data-n]').forEach(b => b.classList.toggle('on', +b.dataset.n === o.themeN));
    $('planThemeInfo').textContent = tag ? `#${tag} 메뉴 ${menus().filter(x => tagsOf(x).includes(tag)).length}개` : '';
  } else {
    $('planParts').replaceChildren(...PARTS.map(p => button(p.label, () => {
      setPlan({ parts: { ...o.parts, [p.key]: !o.parts[p.key] } });
      renderPlan();
    }, o.parts[p.key] ? 'on' : '')));
    $('planSides').hidden = !o.parts.side;
    document.querySelectorAll('#planSides [data-n]').forEach(b => b.classList.toggle('on', +b.dataset.n === o.sides));
    const m = seasonMonth();
    $('planSeason').checked = o.season;
    $('planSeasonWords').textContent = `${m}월: ${seasonWords(m).join(', ') || '(없음)'}`;
  }
  $('planRowsHint').textContent = '메뉴를 누르면 그것만 다시 뽑아요.' + (mode === 'random' ? ' 테두리 = 제철 메뉴' : '');
  const parts = mode === 'theme' ? [THEME] : PARTS.filter(p => o.parts[p.key]);
  $('planRows').replaceChildren(...picks.map((d, i) => {
    const row = h('div', 'plan-row' + (planDays[i] ? '' : ' off'));
    row.append(h('span', 'plan-day', `${WD[i]} ${fmtMD(toStr(planWeek + i))}`));
    const items = h('div', 'plan-items');
    for (const p of parts) {
      const list = p === THEME ? d.theme.slice(0, o.themeN) : p.key === 'side' ? d.side.slice(0, o.sides) : [d[p.key]];
      list.forEach((x, k) => {
        if (!x) { if (p !== THEME || !k) items.append(h('span', 'none', `${p.label} 없음`)); return; } // 테마는 모자라면 있는 만큼만
        const b = button(x.name, () => reroll(i, p, k), mode === 'random' && o.season && seasonal(x) ? 'season' : '');
        b.title = `${p.label} · 눌러서 다시 뽑기`;
        items.append(b);
      });
    }
    row.append(items);
    return row;
  }));
}
function setPick(list) {
  setPlan({ pick: list });
  renderPlan();
}

$('planBtn').addEventListener('click', () => {
  const n = toNum(selected);
  setWeek(n - weekday(n));
  $('planSeasonText').hidden = true;
  $('planner').showModal();
});
$('planPrev').addEventListener('click', () => setWeek(planWeek - 7));
$('planNext').addEventListener('click', () => setWeek(planWeek + 7));
$('planSlot').addEventListener('click', e => {
  const b = e.target.closest('[data-slot]');
  if (!b) return;
  const o = plan();
  setPlan({ slots: { ...o.slots, [o.mode]: b.dataset.slot } });
  renderPlan();
});
$('planMode').addEventListener('click', e => {
  const b = e.target.closest('[data-mode]');
  if (!b) return;
  setPlan({ mode: b.dataset.mode });
  renderPlan();
});
$('planThemeN').addEventListener('click', e => {
  const b = e.target.closest('[data-n]');
  if (!b) return;
  setPlan({ themeN: +b.dataset.n });
  renderPlan();
});
$('planSides').addEventListener('click', e => {
  const b = e.target.closest('[data-n]');
  if (!b) return;
  setPlan({ sides: +b.dataset.n });
  renderPlan();
});
$('planSeason').addEventListener('change', e => {
  setPlan({ season: e.target.checked });
  rollAll();
  renderPlan();
});
// 제철 재료 편집: 그 달 것만 계정에 저장 (안 고친 달은 기본값)
$('planSeasonEdit').addEventListener('click', () => {
  const t = $('planSeasonText');
  t.hidden = !t.hidden;
  t.value = seasonWords(seasonMonth()).join(', ');
  if (!t.hidden) t.focus();
});
$('planSeasonText').addEventListener('change', e => {
  const m = seasonMonth();
  let r = db.recs.find(x => x.id === seasonId(m));
  if (!r) {
    r = { ...newRec('season', { month: m }), id: seasonId(m) };
    db.recs.push(r);
  }
  r.items = parseIngredients(e.target.value);
  touch(r);
  save();
  renderPlan();
});
$('planReroll').addEventListener('click', () => { rollAll(); renderPlan(); });
menuInput($('planInput'), $('planSuggest'), name => {
  const o = plan();
  if (!o.pick.some(x => norm(x) === norm(name))) setPick([...o.pick, name]);
});
$('planClose').addEventListener('click', () => $('planner').close());
// 직접 고른 메뉴를 고른 요일·끼니에서 빼기 (들어 있는 것만, 없으면 아무것도 안 함)
$('planRemove').addEventListener('click', () => {
  const o = plan(), s = o.slots.pick, names = o.pick.map(norm);
  const hits = planDays.flatMap((on, i) => on
    ? mealsOn(toStr(planWeek + i)).filter(m => m.slot === s && names.includes(norm(mealName(m)))) : []);
  if (!hits.length) { toast(o.pick.length ? `고른 요일의 ${SLOTS[s]} 식단에 이 메뉴가 없어요` : '뺄 메뉴를 먼저 골라 주세요'); return; }
  const lines = hits.map(m => `· ${fmtMD(m.date)}(${WD[weekday(toNum(m.date))]}) ${mealName(m)}`);
  if (!confirm(`${SLOTS[s]} 식단에서 ${hits.length}개를 뺄까요?\n\n${lines.join('\n')}`)) return;
  hits.forEach(remove);
  $('planner').close();
  save();
  toast(`${SLOTS[s]} 식단에서 ${hits.length}개를 뺐어요`);
});
$('planApply').addEventListener('click', () => {
  const o = plan(), s = slotOf(o);
  let n = 0;
  planDays.forEach((on, i) => {
    if (!on) return;
    const date = toStr(planWeek + i);
    const names = o.mode === 'pick' ? o.pick : dayMenus(i).map(x => x.name);
    const have = mealsOn(date).filter(m => m.slot === s).map(m => norm(mealName(m)));
    for (const name of names) {
      if (have.includes(norm(name))) continue;
      pushMeal(date, s, name);
      have.push(norm(name));
      n++;
    }
  });
  if (!n) { alert('새로 넣을 메뉴가 없어요. 요일과 메뉴를 확인해 주세요.'); return; }
  $('planner').close();
  save();
  toast(`${SLOTS[s]} 식단에 ${n}개를 넣었어요`);
});
