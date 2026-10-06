'use strict';
// 한 주 식단: 고른 주(일~토)의 요일·끼니에 한꺼번에 넣기
//  - 랜덤 추천: 밥·국·반찬(1~3개)·메인을 켜고 끈 조합으로, 같은 주에는 되도록 안 겹치게. 메뉴를 누르면 그것만 다시 뽑기
//    제철 재료 우선: 그 달 제철 재료(menu-presets.js SEASON_PRESETS, 고치면 계정에 저장)가 들어간 메뉴부터
//  - 직접 고르기: 적은 메뉴를 고른 요일마다 (예: 아침 요거트)
// 이미 그 끼니에 같은 메뉴가 있으면 건너뜀. meals.js 의 menus, pushMeal, mealsOn 등을 그대로 사용

// 추천 칸마다 고르는 곳 [카테고리, 서브카테고리]
const PARTS = [
  { key: 'rice', label: '밥', from: [['한식', '밥']] },
  { key: 'soup', label: '국', from: [['한식', '국'], ['한식', '찌개']] },
  { key: 'side', label: '반찬', from: [['반찬', '볶음'], ['반찬', '무침'], ['반찬', '나물'], ['반찬', '기타']] },
  { key: 'main', label: '메인', from: [['반찬', '단백질'], ['한식', '구이'], ['한식', '볶음'], ['한식', '찜']] },
];
// 기기별 설정 (끼니는 방식마다 따로: 추천은 보통 저녁, 직접은 보통 아침)
const plan = () => ({
  mode: 'random', slots: { random: 'd', pick: 'b' }, parts: { rice: true, soup: true, side: true, main: true },
  sides: 2, season: false, pick: [], ...prefs.plan,
});
function setPlan(patch) {
  prefs.plan = { ...plan(), ...patch };
  savePrefs();
}

let planWeek = 0;  // 그 주 일요일 (일 번호)
let planDays = []; // 넣을 요일 7개 (true/false)
let picks = [];    // 요일별 추천 { rice, soup, side: [3개], main } — 메뉴 또는 null

// ---------- 제철 ----------
const seasonMonth = () => ymd(toStr(planWeek + 3))[1]; // 그 주 수요일의 달
const seasonId = m => `season-${m}`; // 달마다 한 줄 (id가 같아서 기기끼리 겹치지 않음)
function seasonWords(m) {
  const r = recs('season').find(x => x.id === seasonId(m));
  return r ? r.items : SEASON_PRESETS[m].split(',').map(s => s.trim());
}
// 한 글자는 그 글자로 시작할 때만 ('무' → 무말랭이, 무침은 아님)
const hit = (s, w) => w.length > 1 ? s.includes(w) : s.startsWith(w);
function seasonal(x) {
  const ws = seasonWords(seasonMonth()).map(norm);
  return ws.some(w => hit(norm(x.name), w) || (x.ingredients || []).some(g => hit(norm(g), w)));
}

// ---------- 뽑기 ----------
const inPart = (p, x) => p.from.some(([c, s]) => x.cat === c && (x.sub || '') === s);
const usedIn = key => picks.flatMap(d => [].concat(d[key])).filter(Boolean);
const shuffle = a => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
// 이번 주에 안 쓴 것 중에서 (다 썼으면 아무거나), 제철 우선이면 제철인 것 먼저. avoid는 빼고
function draw(p, avoid) {
  const all = menus().filter(x => inPart(p, x) && !avoid.includes(x)), used = usedIn(p.key);
  let c = all.filter(x => !used.includes(x));
  if (!c.length) c = all;
  if (plan().season) {
    const s = c.filter(seasonal);
    if (s.length) c = s;
  }
  return c.length ? c[Math.floor(Math.random() * c.length)] : null;
}
function rollAll() {
  picks = Array.from({ length: 7 }, () => ({ rice: null, soup: null, side: [null, null, null], main: null }));
  // 켠 요일 먼저, 순서는 섞어서 뽑기 (제철 메뉴가 앞 요일이나 끈 요일에 몰리지 않게)
  const days = [0, 1, 2, 3, 4, 5, 6];
  for (const i of [...shuffle(days.filter(i => planDays[i])), ...days.filter(i => !planDays[i])]) {
    for (const p of PARTS) {
      if (p.key === 'side') for (let k = 0; k < 3; k++) picks[i].side[k] = draw(p, picks[i].side);
      else picks[i][p.key] = draw(p, []);
    }
  }
}
function reroll(i, p, k) {
  const d = picks[i];
  const x = draw(p, p.key === 'side' ? d.side : [d[p.key]]);
  if (!x) return;
  if (p.key === 'side') d.side[k] = x; else d[p.key] = x;
  renderPlan();
}
// 그날 넣을 메뉴 (켜 둔 칸만, 밥·국·반찬·메인 순)
function dayMenus(i) {
  const o = plan(), d = picks[i];
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
  const o = plan(), random = o.mode === 'random';
  $('planTitle').textContent = `${fmtMD(toStr(planWeek))}(일) ~ ${fmtMD(toStr(planWeek + 6))}(토)`;
  $('planDays').replaceChildren(...WD.map((w, i) => button(w, () => { planDays[i] = !planDays[i]; renderPlan(); }, planDays[i] ? 'on' : '')));
  document.querySelectorAll('#planSlot [data-slot]').forEach(b => b.classList.toggle('on', b.dataset.slot === o.slots[o.mode]));
  document.querySelectorAll('#planMode [data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === o.mode));
  $('planRandom').hidden = !random;
  $('planReroll').hidden = !random;
  $('planPick').hidden = random;
  if (!random) {
    $('planChosen').replaceChildren(...o.pick.map(name => {
      const b = button(`${name} ✕`, () => setPick(o.pick.filter(x => x !== name)), 'on');
      b.title = '빼기';
      return b;
    }));
    return;
  }
  $('planParts').replaceChildren(...PARTS.map(p => button(p.label, () => {
    setPlan({ parts: { ...o.parts, [p.key]: !o.parts[p.key] } });
    renderPlan();
  }, o.parts[p.key] ? 'on' : '')));
  $('planSides').hidden = !o.parts.side;
  document.querySelectorAll('#planSides [data-n]').forEach(b => b.classList.toggle('on', +b.dataset.n === o.sides));
  const m = seasonMonth();
  $('planSeason').checked = o.season;
  $('planSeasonWords').textContent = `${m}월: ${seasonWords(m).join(', ') || '(없음)'}`;
  $('planRows').replaceChildren(...picks.map((d, i) => {
    const row = h('div', 'plan-row' + (planDays[i] ? '' : ' off'));
    row.append(h('span', 'plan-day', `${WD[i]} ${fmtMD(toStr(planWeek + i))}`));
    const items = h('div', 'plan-items');
    for (const p of PARTS.filter(p => o.parts[p.key])) {
      const list = p.key === 'side' ? d.side.slice(0, o.sides) : [d[p.key]];
      list.forEach((x, k) => {
        if (!x) { items.append(h('span', 'none', `${p.label} 없음`)); return; }
        const b = button(x.name, () => reroll(i, p, k), o.season && seasonal(x) ? 'season' : '');
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
// 제철 재료 고치기: 그 달 것만 계정에 저장 (안 고친 달은 기본값)
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
$('planApply').addEventListener('click', () => {
  const o = plan(), s = o.slots[o.mode];
  let n = 0;
  planDays.forEach((on, i) => {
    if (!on) return;
    const date = toStr(planWeek + i);
    const names = o.mode === 'random' ? dayMenus(i).map(x => x.name) : o.pick;
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
