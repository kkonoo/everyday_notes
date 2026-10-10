'use strict';
// 놀이 (설정 맨 위 🎲 놀이로 여는 전체 화면): 메뉴 룰렛 · 룰렛 · 제비뽑기 · 사다리타기
// 뽑기·각도·사다리 계산은 play-core.js (crypto 난수). 결과를 먼저 정하고 화면은 그 결과대로 움직이기만 함 → 룰렛이 멈춘 칸 = 발표 결과
// 데이터는 메뉴 룰렛의 '이걸로 할게요'(고른 날짜·끼니 식단에 넣기, meals.js 의 pushMeal)만 바꿈
// 설정·저장한 룰렛 목록은 이 기기에만 (prefs.play). 소리는 기본 꺼짐, 결과가 나오면 짧게 진동 (되는 폰만)
const PLAY_TABS = { menu: '메뉴 룰렛', wheel: '룰렛', lots: '제비뽑기', ladder: '사다리' };
const BOARD_MAX = 16;   // 메뉴 룰렛 판의 칸 수 (후보가 더 많으면 무작위로 이만큼)
const WHEEL_MAX = 24;   // 그냥 룰렛 칸 수
const RECENT_DAYS = 30; // 후보 '최근 식단' 기간
const playPrefs = () => ({
  tab: 'menu', src: { menu: true, recent: false, cook: false, custom: false }, cuisine: '', tag: '', skip: true, skipDays: 3, custom: '',
  open: {}, items: '', lists: [], lotsN: 6, lotsK: 1, ladderN: 4, people: [], prizes: [], sound: false, ...prefs.play,
});
function setPlay(patch) {
  prefs.play = { ...playPrefs(), ...patch };
  savePrefs();
}

// 앱을 켜 둔 동안만 기억하는 것
let playBusy = false; // 돌아가는 중: 다시 그리지 않음 (동기화로 render가 와도). 끝나면 다시 그림
const wheelState = { menu: { rot: 0, board: '', result: null }, wheel: { rot: 0, board: '', result: null } }; // 판 각도·마지막 결과
const menuRemoved = new Set(); // 메뉴 후보에서 눌러서 뺀 것 (이름 키)
let menuBoard = { key: null, names: [] }; // 판에 올린 메뉴 (후보가 바뀌거나 '다시 섞기'를 누를 때만 다시 고름)
let lotsState = null;   // { n, k, wins, open: Set }
let ladderState = null; // { lad, people, prizes, shown: Set (사다리를 탄 참가자, 탄 순서), X, Y }

// ---------- 소리·진동 ----------
const playWait = ms => new Promise(ok => setTimeout(ok, ms));
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const buzz = () => { if (navigator.vibrate) navigator.vibrate(80); };
let playAudio = null;
function beep(freq, ms = 30, vol = 0.06) {
  if (!playPrefs().sound) return;
  try {
    playAudio = playAudio || new AudioContext();
    const o = playAudio.createOscillator(), g = playAudio.createGain(), t = playAudio.currentTime;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
    o.connect(g).connect(playAudio.destination);
    o.start(t);
    o.stop(t + ms / 1000);
  } catch { /* 소리를 못 내는 브라우저 */ }
}
const fanfare = () => { buzz(); beep(660, 140); setTimeout(() => beep(990, 200), 130); };

// ---------- 작은 부품 ----------
function panelHead(title, ...extra) {
  const d = h('div', 'panel-head');
  d.append(h('h2', '', title), ...extra);
  return d;
}
// [−] 숫자 [＋]
function stepper(value, min, max, onSet) {
  const box = h('span', 'stepper');
  const b = (label, v) => { const x = button(label, () => onSet(v), 'icon-btn small'); x.disabled = v < min || v > max; return x; };
  box.append(b('−', value - 1), h('b', '', value), b('＋', value + 1));
  return box;
}

// ---------- 그리기 ----------
function renderPlay() {
  if (playBusy) return;
  const o = playPrefs(), tab = PLAY_TABS[o.tab] ? o.tab : 'menu';
  const head = h('div', 'page-head'), tabs = h('div', 'seg'), back = button('‹', closePage, 'icon-btn');
  back.title = '돌아가기';
  tabs.append(...Object.entries(PLAY_TABS).map(([k, label]) => button(label, () => { setPlay({ tab: k }); render(); }, k === tab ? 'on' : '')));
  const sound = button(o.sound ? '🔊 소리 켬' : '🔇 소리 끔', () => { setPlay({ sound: !o.sound }); render(); }, 'btn small head-end');
  sound.title = '룰렛·제비·사다리 소리 (기본 꺼짐)';
  head.append(back, h('h2', '', '🎲 놀이'), tabs, sound);
  $('playView').replaceChildren(head, { menu: menuPane, wheel: wheelPane, lots: lotsPane, ladder: ladderPane }[tab]());
  if (tab === 'menu') paintMenu();
  else if (tab === 'wheel') paintWheel();
  else if (tab === 'ladder' && ladderState) drawLadder();
}

// ---------- 룰렛 판 ----------
// names 순서 = 판의 칸 순서 (맨 위에서 시계 방향). result(이름) = 결과 칸에 보일 것
function wheelBox(key, names, result) {
  const st = wheelState[key], box = h('div', 'wheel-box'), wrap = h('div', 'wheel-wrap'), disc = h('div', 'wheel'), out = h('div', 'wheel-result');
  const board = names.join('\n');
  if (st.board !== board) { st.board = board; st.result = null; } // 판이 바뀌면 지난 결과는 지움
  disc.style.transform = `rotate(${st.rot}deg)`;
  disc.append(wheelSvg(names));
  wrap.append(h('span', 'wheel-pointer'), disc);
  const go = button(st.result ? '다시 돌리기' : '돌리기', () => spinBoard(key, names, disc, go, out), 'btn primary spin-btn');
  go.disabled = names.length < 2;
  if (st.result) out.append(result(st.result));
  else if (names.length < 2) out.append(h('p', 'hint', '후보가 2개 이상 있어야 돌릴 수 있어요'));
  box.append(wrap, go, out);
  return box;
}
// 칸 i = 위(0°)에서 시계 방향으로 i·s ~ (i+1)·s 도 (play-core.js sliceAt과 같은 기준)
function wheelSvg(names) {
  const n = names.length, S = 300, c = S / 2, r = c - 3, s = svg('svg', { class: 'wheel-svg', viewBox: `0 0 ${S} ${S}` });
  if (n < 2) {
    s.append(svg('circle', { class: 'wheel-empty', cx: c, cy: c, r: r - 2 }));
    return s;
  }
  const step = 360 / n, fs = n <= 6 ? 16 : n <= 10 ? 14 : n <= 16 ? 12 : 10;
  const pt = deg => [c + r * Math.sin(deg * Math.PI / 180), c - r * Math.cos(deg * Math.PI / 180)];
  const L = NOTE_COLORS.length;
  names.forEach((name, i) => {
    const [x1, y1] = pt(i * step), [x2, y2] = pt((i + 1) * step);
    const color = NOTE_COLORS[i === n - 1 && i % L === 0 ? 1 : i % L]; // 마지막 칸이 첫 칸과 같은 색이면 다음 색
    s.append(svg('path', { d: `M${c},${c}L${x1.toFixed(2)},${y1.toFixed(2)}A${r},${r} 0 0 1 ${x2.toFixed(2)},${y2.toFixed(2)}Z`, fill: color, 'data-i': i }));
    // 글자는 칸 가운데 줄을 따라 바깥쪽 끝에서. 왼쪽 절반은 뒤집히지 않게 반대로 돌려서 바깥 → 안쪽으로
    const mid = i * step + step / 2, left = mid > 180;
    const t = svg('text', { x: left ? c - r + 12 : c + r - 12, y: c, transform: `rotate(${left ? mid + 90 : mid - 90} ${c} ${c})`, 'font-size': fs, class: left ? 'left' : '' });
    t.textContent = name.length > 7 ? `${name.slice(0, 6)}…` : name;
    s.append(t);
  });
  s.append(svg('circle', { class: 'wheel-hub', cx: c, cy: c, r: 14 }));
  return s;
}
// 돌리기: 칸을 먼저 뽑고(spinWheel) 판을 그 각도까지 돌린 뒤, 같은 칸 이름을 결과로
function spinBoard(key, names, disc, go, out) {
  if (playBusy || names.length < 2) return;
  const st = wheelState[key], { index, rotation } = spinWheel(names.length, st.rot), ms = reduceMotion() ? 600 : 4200;
  playBusy = true;
  st.result = null;
  go.disabled = true;
  out.replaceChildren();
  disc.style.transition = `transform ${ms}ms cubic-bezier(.15, .6, .1, 1)`;
  disc.style.transform = `rotate(${rotation}deg)`;
  st.rot = rotation;
  if (playPrefs().sound) tickWhile(disc, names.length, ms);
  setTimeout(() => {
    st.result = names[index];
    playBusy = false;
    fanfare();
    render();
  }, ms + 50);
}
// 소리를 켰으면 칸이 바늘을 지날 때마다 틱
function tickWhile(disc, n, ms) {
  const end = performance.now() + ms;
  let last = null;
  const f = () => {
    try {
      const m = new DOMMatrix(getComputedStyle(disc).transform), i = sliceAt(Math.atan2(m.b, m.a) * 180 / Math.PI, n);
      if (last !== null && i !== last) beep(1400, 12, 0.03);
      last = i;
    } catch { return; }
    if (performance.now() < end) requestAnimationFrame(f);
  };
  requestAnimationFrame(f);
}

// ---------- 메뉴 룰렛 ----------
const mealsForPlay = () => recs('meal').map(m => ({ date: m.date, name: mealName(m) }));
const myMenus = o => menus().filter(x => (!o.cuisine || cuisineOf(x) === o.cuisine) && (!o.tag || tagsOf(x).includes(o.tag)));
// 후보: 고른 곳들에서 모아 겹치는 이름 빼고 → (켰으면) 최근 N일 먹은 것 빼고 → 눌러서 뺀 것 빼기. 판에는 BOARD_MAX개까지
function menuData() {
  const o = playPrefs(), meals = mealsForPlay(), today = todayStr();
  const src = {
    menu: myMenus(o).map(x => x.name),
    recent: eatenWithin(meals, today, RECENT_DAYS),
    cook: cookPlans().filter(p => !p.missing.length).map(p => p.m.name),
    custom: parseIngredients(o.custom),
  };
  const all = uniqueNames(Object.keys(src).filter(k => o.src[k]).flatMap(k => src[k]));
  const left = o.skip ? withoutRecent(all, meals, today, o.skipDays) : all;
  const names = left.filter(x => !menuRemoved.has(nameKey(x)));
  const key = names.join('\n');
  if (menuBoard.key !== key) menuBoard = { key, names: names.length > BOARD_MAX ? cryptoShuffle(names).slice(0, BOARD_MAX) : names };
  return { o, src, all, left, names };
}
function menuPane() {
  const { o, src } = menuData(), grid = h('div', 'play-grid'), stage = h('section', 'panel play-stage'), side = h('section', 'panel play-side');
  stage.id = 'playStage';
  // 후보 가져오기: 체크해서 섞어 쓰기
  const srcRow = (k, label, n) => {
    const row = h('label', 'src-row'), box = h('input');
    box.type = 'checkbox';
    box.checked = !!o.src[k];
    box.addEventListener('change', () => { setPlay({ src: { ...o.src, [k]: box.checked } }); render(); });
    row.append(box, h('span', '', label), h('span', 'count', n));
    return row;
  };
  side.append(panelHead('후보 가져오기'), srcRow('menu', '내 메뉴·레시피', `${src.menu.length}개`));
  if (o.src.menu) {
    const sub = h('div', 'src-sub'), cs = h('select'), ts = h('select');
    const cuisines = [...new Set(menus().map(cuisineOf))].sort(ranker(CUISINES)), tags = [...new Set(menus().flatMap(tagsOf))].sort(ranker(TAG_PRESETS));
    fillSelect(cs, [['', '종류 전체'], ...cuisines.map(c => [c, c])], o.cuisine);
    fillSelect(ts, [['', '태그 전체'], ...tags.map(t => [t, `#${t}`])], o.tag);
    cs.addEventListener('change', () => { setPlay({ cuisine: cs.value }); render(); });
    ts.addEventListener('change', () => { setPlay({ tag: ts.value }); render(); });
    sub.append(...(menus().length ? [cs, ...(tags.length ? [ts] : [])] : [h('span', 'hint', '식단 › 메뉴·레시피에 메뉴가 없어요')]));
    side.append(sub);
  }
  side.append(srcRow('recent', `최근 ${RECENT_DAYS}일 식단에 나온 메뉴`, `${src.recent.length}개`),
    srcRow('cook', '냉장고 ‘지금 만들 수 있어요’', `${src.cook.length}개`), srcRow('custom', '직접 입력', ''));
  if (o.src.custom) {
    const sub = h('div', 'src-sub'), ta = h('textarea');
    ta.rows = 2;
    ta.placeholder = '쉼표나 줄바꿈으로 (예: 짜장면, 피자)';
    ta.value = o.custom;
    ta.dataset.key = 'play-custom';
    ta.addEventListener('input', () => { setPlay({ custom: ta.value }); paintMenu(); }); // 판만 다시 (입력 칸은 그대로 → 한글 조합이 안 끊기게)
    sub.append(ta);
    side.append(sub);
  }
  // 최근 N일 안에 먹은 메뉴 빼기 (오늘 포함)
  const skip = h('div', 'src-row'), lab = h('label', 'src-check'), box = h('input');
  box.type = 'checkbox';
  box.checked = o.skip;
  box.addEventListener('change', () => { setPlay({ skip: box.checked }); render(); });
  lab.append(box, '최근');
  skip.append(lab, stepper(o.skipDays, 1, 30, v => { setPlay({ skipDays: v }); render(); }), h('span', '', '일 안에 먹은 메뉴 빼기'));
  const cand = h('div');
  cand.id = 'playCand';
  side.append(h('div', 'src-line'), skip, cand);
  grid.append(stage, side);
  return grid;
}
// 판과 후보 칩만 다시 그림 (직접 입력 칸에 적는 중에도)
function paintMenu() {
  if (playBusy) return;
  const { o, all, left, names } = menuData(), stage = $('playStage');
  stage.replaceChildren(wheelBox('menu', menuBoard.names, menuResult));
  if (names.length > BOARD_MAX) {
    const row = h('div', 'board-note');
    row.append(h('span', 'hint', `후보 ${names.length}개 중 무작위 ${BOARD_MAX}개를 올렸어요`), button('다시 섞기', () => { menuBoard.key = null; paintMenu(); }, 'btn small'));
    stage.append(row);
  }
  // 후보 칩: 누르면 빼기·되돌리기
  const head = h('div', 'cand-head');
  head.append(h('b', '', `후보 ${names.length}개`));
  if (o.skip && all.length > left.length) head.append(h('span', 'hint', `최근 ${o.skipDays}일 먹은 ${all.length - left.length}개 뺌`));
  if (menuRemoved.size) head.append(button('뺀 것 되돌리기', () => { menuRemoved.clear(); paintMenu(); }, 'btn small'));
  const chip = x => {
    const off = menuRemoved.has(nameKey(x)), b = button(x, () => {
      if (off) menuRemoved.delete(nameKey(x)); else menuRemoved.add(nameKey(x));
      paintMenu();
    }, off ? 'off' : '');
    b.title = off ? '눌러서 다시 넣기' : '눌러서 후보에서 빼기';
    return b;
  };
  // 메뉴 그룹(종류 › 분류)별로, 메뉴·레시피와 같은 순서. 그룹 안은 하위분류 → 가나다
  // 제목을 누르면 펼치기·접기 (처음엔 접힘, 바꾼 것은 이 기기에 기억). 메뉴·레시피에 없는 이름(직접 입력·식단에만 있는 것)은 맨 위, 처음부터 펼침
  const byName = new Map(menus().map(m => [nameKey(m.name), m])), menuOfName = x => byName.get(nameKey(x));
  const groupOf = x => { const m = menuOfName(x); return m ? `${cuisineOf(m)}›${courseOf(m)}` : ''; };
  const order = (a, b) => (a !== '') - (b !== '') || ranker(CUISINES)(a.split('›')[0], b.split('›')[0]) || abc(a.split('›')[1] || '', b.split('›')[1] || '');
  const subOf = x => (menuOfName(x) || {}).sub || '';
  const groups = groupBy(left, groupOf, order), open = o.open, list = h('div', 'cand-groups');
  for (const [key, ns] of groups) {
    const isOpen = open[key] ?? (key === '' || groups.length === 1), off = ns.filter(x => menuRemoved.has(nameKey(x))).length;
    const [c, k] = key.split('›'), gh = h('div', 'menu-sub' + (isOpen ? '' : ' folded'));
    gh.append(h('span', 'fold', '▾'), h('span', 'name', key ? [c, known(k)].filter(Boolean).join(' › ') : '메뉴·레시피에 없는 이름'),
      h('span', 'count', `${ns.length}개` + (off ? ` · ${off}개 뺌` : '')));
    gh.title = isOpen ? '접기' : '펼치기';
    gh.addEventListener('click', () => { setPlay({ open: { ...playPrefs().open, [key]: !isOpen } }); paintMenu(); });
    list.append(gh);
    if (!isOpen) continue;
    const chips = h('div', 'pills cand');
    chips.append(...[...ns].sort((a, b) => abc(subOf(a), subOf(b)) || a.localeCompare(b, 'ko')).map(chip));
    list.append(chips);
  }
  $('playCand').replaceChildren(head, left.length ? list
    : h('p', 'hint', Object.values(o.src).some(Boolean) ? '후보가 없어요' : '위에서 후보를 가져올 곳을 골라 주세요'));
}
function menuResult(name) {
  const box = h('div', 'result');
  box.append(h('p', 'result-text', `‘${name}’ 어때요? 🍽️`), button('이걸로 할게요', () => openPickMeal(name), 'btn primary'));
  return box;
}

// 이걸로 할게요: 날짜(오늘·내일·고르기)와 끼니(지금 시각으로 미리)를 골라 식단에. 내일 이후면 미리 넣어 두는 계획
// 그 끼니에 같은 메뉴가 이미 있으면 안 넣음 (만들었어요·한 주 식단과 같음)
let picking = null, pickDate = '', pickSlot = 'd';
const pickDays = () => toNum(pickDate) - toNum(todayStr());
const pickedAlready = () => mealsOn(pickDate).some(x => x.slot === pickSlot && norm(mealName(x)) === norm(picking));
const pickDayText = () => ({ 0: '오늘', 1: '내일' }[pickDays()] || `${ymd(pickDate)[1]}월 ${ymd(pickDate)[2]}일`);
function openPickMeal(name) {
  picking = name;
  pickDate = todayStr();
  pickSlot = slotNow();
  $('pickTitle').textContent = `‘${name}’ 식단에 넣기`;
  syncPick();
  $('pickMeal').showModal();
}
function syncPick() {
  document.querySelectorAll('#pickDay [data-day]').forEach(b => b.classList.toggle('on', +b.dataset.day === pickDays()));
  document.querySelectorAll('#pickSlot [data-slot]').forEach(b => b.classList.toggle('on', b.dataset.slot === pickSlot));
  $('pickDate').value = pickDate;
  const already = pickedAlready();
  $('pickNote').textContent = already ? `${pickDayText()} ${SLOTS[pickSlot]}에 이미 있어요.` : pickDays() > 0 ? '식단에 미리 넣어 둬요 (계획).' : '';
  $('pickOk').disabled = already;
}
$('pickDay').addEventListener('click', e => {
  const b = e.target.closest('[data-day]');
  if (b) { pickDate = toStr(toNum(todayStr()) + +b.dataset.day); syncPick(); }
});
$('pickDate').addEventListener('change', e => { if (e.target.value) { pickDate = e.target.value; syncPick(); } });
$('pickSlot').addEventListener('click', e => {
  const b = e.target.closest('[data-slot]');
  if (b) { pickSlot = b.dataset.slot; syncPick(); }
});
$('pickCancel').addEventListener('click', () => $('pickMeal').close());
$('pickOk').addEventListener('click', () => {
  if (pickedAlready()) return;
  pushMeal(pickDate, pickSlot, picking);
  $('pickMeal').close();
  save();
  toast(`${pickDayText()} ${SLOTS[pickSlot]} 식단에 넣었어요`);
});

// ---------- 룰렛: 항목 직접, 자주 쓰는 목록은 저장 (이 기기에만) ----------
function wheelPane() {
  const o = playPrefs(), grid = h('div', 'play-grid'), stage = h('section', 'panel play-stage'), side = h('section', 'panel play-side');
  stage.id = 'playStage';
  const ta = h('textarea'), hint = h('p', 'hint');
  ta.rows = 5;
  ta.placeholder = '쉼표나 줄바꿈으로 (예: 짜장면, 짬뽕, 탕수육)';
  ta.value = o.items;
  ta.dataset.key = 'play-items';
  ta.addEventListener('input', () => { setPlay({ items: ta.value }); paintWheel(); });
  hint.id = 'wheelHint';
  const lists = h('div', 'pills saved-lists');
  lists.append(...o.lists.map(l => {
    const b = button(l.name, () => { setPlay({ items: l.items.join('\n') }); render(); });
    b.title = `${l.items.join(', ')}\n누르면 불러오기 · 길게 누르면(PC는 오른쪽 클릭) 지우기`;
    holdPress(b, () => {
      if (!confirm(`‘${l.name}’ 목록을 지울까요?`)) return;
      setPlay({ lists: playPrefs().lists.filter(x => x.name !== l.name) });
      render();
    });
    return b;
  }));
  side.append(panelHead('항목'), ta, hint, panelHead('저장한 목록', button('＋ 지금 항목 저장', saveWheelList, 'btn small')),
    o.lists.length ? lists : h('p', 'hint', '자주 쓰는 항목은 저장해 두고 눌러서 불러와요. 이 기기에만 저장돼요.'));
  grid.append(stage, side);
  return grid;
}
function paintWheel() {
  if (playBusy) return;
  const all = parseIngredients(playPrefs().items);
  $('playStage').replaceChildren(wheelBox('wheel', all.slice(0, WHEEL_MAX), name => {
    const box = h('div', 'result');
    box.append(h('p', 'result-text', `🎉 ${name}`));
    return box;
  }));
  $('wheelHint').textContent = all.length > WHEEL_MAX ? `판에는 ${WHEEL_MAX}개까지만 올려요 (지금 ${all.length}개)` : '';
}
async function saveWheelList() {
  const items = parseIngredients(playPrefs().items);
  if (items.length < 2) { toast('항목을 2개 이상 적어 주세요'); return; }
  const name = await ask('목록 이름 (예: 점심 메뉴)');
  if (!name) return;
  const lists = playPrefs().lists;
  if (lists.some(l => l.name === name) && !confirm(`‘${name}’ 목록을 지금 항목으로 바꿀까요?`)) return;
  setPlay({ lists: [...lists.filter(l => l.name !== name), { name, items }] });
  render();
  toast(`‘${name}’ 목록을 저장했어요`);
}

// ---------- 제비뽑기: n장 중 k장 당첨. 섞을 때 당첨을 미리 정하고, 한 장씩 눌러서 뒤집기 ----------
function lotsPane() {
  const o = playPrefs(), n = o.lotsN, k = Math.min(o.lotsK, n - 1);
  if (!lotsState || lotsState.n !== n || lotsState.k !== k) lotsState = { n, k, wins: drawLots(n, k), open: new Set() };
  const panel = h('section', 'panel play-one'), setup = h('div', 'play-setup'), cards = h('div', 'lots'), status = h('p', 'play-status'), btns = h('div', 'play-btns');
  setup.append(h('span', '', '모두'), stepper(n, 2, 30, v => { setPlay({ lotsN: v }); render(); }),
    h('span', '', '장 중 당첨'), stepper(k, 1, n - 1, v => { setPlay({ lotsK: v }); render(); }), h('span', '', '장'));
  for (let i = 0; i < n; i++) {
    const c = button('', () => flipLot(i, c), 'lot');
    c.append(h('span', 'lot-back', i + 1), h('span', 'lot-front'));
    if (lotsState.open.has(i)) showLot(i, c);
    cards.append(c);
  }
  status.id = 'lotsStatus';
  status.textContent = lotsText();
  btns.append(button('남은 것 모두 뒤집기', flipAllLots, 'btn'), button('다시 섞기', () => { lotsState = null; render(); }, 'btn'));
  panel.append(setup, h('p', 'hint', '한 장씩 눌러서 뒤집어요.'), cards, status, btns);
  return panel;
}
function lotsText() {
  const { n, k, wins, open } = lotsState, got = [...open].filter(i => wins[i]).length;
  return got === k ? `당첨 ${k}장이 다 나왔어요 🎉` : `${open.size}/${n}장 뒤집음 · 당첨 ${got}/${k}`;
}
// 뒤집을 때 앞면 글자를 넣음 (뒤집기 전엔 화면 어디에도 당첨이 안 적혀 있게)
function showLot(i, c) {
  const win = lotsState.wins[i];
  c.lastChild.textContent = win ? '🎉 당첨' : '꽝';
  c.classList.toggle('win', win);
  c.classList.add('open');
}
function flipLot(i, c) {
  if (lotsState.open.has(i)) return;
  lotsState.open.add(i);
  showLot(i, c);
  if (lotsState.wins[i]) fanfare(); else beep(330, 60);
  $('lotsStatus').textContent = lotsText();
}
async function flipAllLots() {
  if (playBusy) return;
  playBusy = true;
  const cards = [...document.querySelectorAll('#playView .lot')];
  for (let i = 0; i < lotsState.n; i++) {
    if (lotsState.open.has(i)) continue;
    flipLot(i, cards[i]);
    await playWait(350);
  }
  playBusy = false;
}

// ---------- 사다리타기: 이름 n개, 결과 n개. 사다리를 먼저 만들고, 이름을 누르면 그 길(traceLadder)을 따라 내려감 ----------
const LADDER_COLORS = ['var(--dinner)', 'var(--snack)', 'var(--lunch)', 'var(--night)', 'var(--breakfast)', 'var(--sun)', 'var(--sat)', '#B99AF0'];
const ladderColor = i => LADDER_COLORS[i % LADDER_COLORS.length];
function ladderPane() {
  const o = playPrefs(), st = ladderState, n = st ? st.lad.n : o.ladderN, panel = h('section', 'panel play-one'), btns = h('div', 'play-btns');
  const row = cls => { const r = h('div', cls); r.style.setProperty('--n', n); return r; };
  const top = row('ladder-names'), bottom = row('ladder-prizes'), box = h('div', 'ladder-box');
  box.id = 'ladderBox';
  if (!st) { // 이름·결과 적기
    const setup = h('div', 'play-setup'), cell = (list, i, ph, field) => {
      const a = h('input');
      a.value = list[i] || '';
      a.placeholder = ph;
      a.autocomplete = 'off';
      a.dataset.key = `ladder-${field}${i}`;
      a.addEventListener('input', () => { const v = [...playPrefs()[field]]; v[i] = a.value; setPlay({ [field]: v }); });
      return a;
    };
    setup.append(h('span', '', '참가자'), stepper(n, 2, 8, v => { setPlay({ ladderN: v }); render(); }), h('span', '', '명'));
    for (let i = 0; i < n; i++) { top.append(cell(o.people, i, `${i + 1}번`, 'people')); bottom.append(cell(o.prizes, i, '꽝', 'prizes')); }
    box.append(h('div', 'ladder-blank', '?'));
    btns.append(button('사다리 만들기', () => {
      const p = playPrefs(), pick = (list, i, d) => (list[i] || '').trim() || d;
      ladderState = {
        lad: makeLadder(n), shown: new Set(),
        people: Array.from({ length: n }, (_, i) => pick(p.people, i, `${i + 1}번`)),
        prizes: Array.from({ length: n }, (_, i) => pick(p.prizes, i, '꽝')),
      };
      render();
    }, 'btn primary'));
    panel.append(setup, h('p', 'hint', '위에는 이름, 아래에는 결과를 적어요. 빈칸은 ‘1번…’, ‘꽝’이에요.'), top, box, bottom, btns);
    return panel;
  }
  // 사다리 타기: 이름을 누르면 내려감. 결과는 탄 사람 것만 보임
  st.people.forEach((p, i) => {
    const b = button(p, () => rideLadder(i), st.shown.has(i) ? 'done' : '');
    b.style.setProperty('--lc', ladderColor(i));
    b.title = '눌러서 사다리 타기';
    top.append(b);
  });
  for (let e = 0; e < n; e++) {
    const who = [...st.shown].find(i => traceLadder(st.lad, i).end === e), cell = h('span', who == null ? 'hidden' : 'shown', who == null ? '?' : st.prizes[e]);
    cell.dataset.col = e;
    if (who != null) cell.style.setProperty('--lc', ladderColor(who));
    bottom.append(cell);
  }
  const results = h('ol', 'ladder-results');
  results.id = 'ladderResults';
  for (const i of st.shown) results.append(ladderLine(i));
  btns.append(button('모두 보기', rideAll, 'btn primary'), button('새 사다리', () => {
    ladderState = { ...st, lad: makeLadder(n), shown: new Set() };
    render();
  }, 'btn'), button('이름·결과 고치기', () => { ladderState = null; render(); }, 'btn'));
  if (!st.shown.size) panel.append(h('p', 'hint', '이름을 누르면 사다리를 타요.'));
  panel.append(top, box, bottom, results, btns);
  return panel;
}
const ladderLine = i => {
  const st = ladderState, li = h('li', '', `${st.people[i]} → ${st.prizes[traceLadder(st.lad, i).end]}`);
  li.style.setProperty('--lc', ladderColor(i));
  return li;
};
// 사다리 그림: 세로줄·가로줄 (+ 이미 탄 길). 이름·결과 칸(같은 너비 n칸)의 가운데에 세로줄
function drawLadder() {
  const st = ladderState, box = $('ladderBox'), n = st.lad.n, W = box.clientWidth || 320, RH = 24, H = (st.lad.rows + 1) * RH;
  st.X = c => (c + 0.5) * W / n;
  st.Y = r => (r < 0 ? 0 : r >= st.lad.rows ? H : (r + 1) * RH);
  const s = svg('svg', { class: 'ladder', width: W, height: H, viewBox: `0 0 ${W} ${H}` });
  for (let c = 0; c < n; c++) s.append(svg('line', { class: 'rail', x1: st.X(c), x2: st.X(c), y1: 0, y2: H }));
  st.lad.rungs.forEach((row, r) => row.forEach(c => s.append(svg('line', { class: 'rung', x1: st.X(c), x2: st.X(c + 1), y1: st.Y(r), y2: st.Y(r) }))));
  for (const i of st.shown) s.append(ladderTrail(i));
  box.replaceChildren(s);
}
function ladderTrail(i) {
  const st = ladderState, t = svg('polyline', { class: 'trail', points: traceLadder(st.lad, i).path.map(([c, r]) => `${st.X(c)},${st.Y(r)}`).join(' ') });
  t.style.stroke = ladderColor(i);
  return t;
}
// 길을 그려 내려간 뒤 그 길이 닿은 결과를 보여 줌 (같은 traceLadder 값)
async function rideTrail(i, ms) {
  const st = ladderState, t = ladderTrail(i), end = traceLadder(st.lad, i).end;
  ms = reduceMotion() ? 300 : ms;
  $('ladderBox').firstChild.append(t);
  const len = t.getTotalLength();
  t.style.strokeDasharray = len;
  t.style.strokeDashoffset = len;
  t.getBoundingClientRect(); // 시작 상태를 먼저 적용해야 움직임이 보임
  t.style.transition = `stroke-dashoffset ${ms}ms linear`;
  t.style.strokeDashoffset = 0;
  await playWait(ms + 40);
  st.shown.add(i);
  const cell = document.querySelector(`#ladderBox + .ladder-prizes [data-col="${end}"]`);
  cell.textContent = st.prizes[end];
  cell.className = 'shown';
  cell.style.setProperty('--lc', ladderColor(i));
  $('ladderResults').append(ladderLine(i));
  fanfare();
}
async function rideLadder(i) {
  if (playBusy || ladderState.shown.has(i)) return;
  playBusy = true;
  await rideTrail(i, 1800);
  playBusy = false;
  render();
}
async function rideAll() {
  if (playBusy) return;
  playBusy = true;
  for (let i = 0; i < ladderState.lad.n; i++) if (!ladderState.shown.has(i)) await rideTrail(i, 900);
  playBusy = false;
  render();
}

$('playBtn').addEventListener('click', () => { $('settings').close(); openPage('play'); });
