'use strict';
// 살림노트 공통: 날짜 유틸, 저장, 그리기, 설정, 끌어서 순서 바꾸기, 폰 뒤로 가기
// 노트는 notes.js, 식단은 meals.js, 가계부는 budget.js, 로그인·동기화는 sync.js (서로 전역 변수·함수를 같이 씀)

// ---------- 날짜 유틸: 'YYYY-MM-DD' 문자열 ↔ 일(day) 번호 ----------
const DAY_MS = 86400000;
const WD = ['일', '월', '화', '수', '목', '금', '토'];
const pad = n => String(n).padStart(2, '0');
const toNum = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / DAY_MS;
const toStr = n => new Date(n * DAY_MS).toISOString().slice(0, 10);
const ymd = s => [+s.slice(0, 4), +s.slice(5, 7), +s.slice(8, 10)];
const weekday = n => (n + 4) % 7; // 1970-01-01 = 목요일
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const fmtDay = s => { const [, m, d] = ymd(s); return `${m}월 ${d}일 ${WD[weekday(toNum(s))]}요일`; };
const fmtMD = s => { const [, m, d] = ymd(s); return `${m}/${d}`; };

// ---------- 저장소 ----------
// db.recs = 노트·항목·메뉴·식단을 한 배열에 (kind로 구분). 동기화는 한 줄(rec)씩, updatedAt이 늦은 쪽이 이김
//   note:  { type: 'shop'|'check'|'list'|'memo', cat, title, sections: [{ id, name }], text, order }   list = 주제별 메모 목록
//   entry: { note, section, text, done, need, memo, order }   need = 장보기의 '살 것', memo = 목록 항목의 내용
//   menu:  { name, cuisine, course, sub, tags: [], ingredients: [], recipe, link }   종류 › 분류 › 하위분류 (없으면 ''), tags = 계절·손님초대 등
//   meal:  { date, slot: 'b'|'l'|'s'|'d'|'n' (아침·점심·간식·저녁·야식), name, menu, order }
//   season: { month, items: [] }   id = 'season-월' — 제철 재료. 고친 달만 (나머지는 menu-presets.js 기본값)
//   groups: { paths: [[종류, 분류?, 하위분류?]] }   id = 'menu-groups' — 직접 만든 빈 메뉴 그룹 (메뉴 분류 정리의 ＋)
//   tags: { hidden: [] }   id = 'menu-tags' — 설정에서 지운 기본 태그 (편집 창 목록에서 뺌)
//   notecat: { name, color, order }   노트에 붙이는 내 카테고리 (note.cat = id). 노트 색 = 카테고리 색, 없으면 종류 색
//   bline: { side: 'in'|'out'|'save' (수입·지출·저축), group (지출 분류 id), account (통장 id), name, plans: { 'YYYY-MM': 금액 }, actual: { 달: 금액 }, fixed, from, to, order }   가계부 예산 항목
//   asset: { type, name, values: { 'YYYY-MM': 금액 }, from, to, order }   재산 (대출은 빼기) / goal: { name, target, by: 'YYYY-MM', assets: [id] (비면 순자산 전체), order }
//   bconf: { groups: [{ id, name }], accounts: [{ id, name }] }   id = 'budget' — 가계부 지출 분류·통장 (순서대로)
//   + 공통 { id, kind, createdAt, updatedAt, deleted }
// 같은 주소(kkonoo.github.io)의 캘린더x플래너와 localStorage를 같이 쓰므로 키 이름을 다르게
const KEY = 'everyday.v1', PKEY = 'everyday.prefs';
const readJSON = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
let db = readJSON(KEY) || { version: 1, recs: [] };
let prefs = readJSON(PKEY) || {}; // 기기별 설정 (동기화 안 함)
const savePrefs = () => localStorage.setItem(PKEY, JSON.stringify(prefs));
const persist = () => localStorage.setItem(KEY, JSON.stringify(db));
// 변경 저장 → 다시 그리기 → (로그인돼 있으면) sync.js가 계정에 올림
function save() { persist(); render(); if (window.onSave) window.onSave(); }

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
function newRec(kind, fields) {
  const t = Date.now();
  return { id: uid(), kind, createdAt: t, updatedAt: t, ...fields };
}
const touch = r => { r.updatedAt = Date.now(); };
// 삭제는 표시만 (다른 기기에 삭제를 전달하려고)
const remove = r => { r.deleted = true; touch(r); };
const recs = kind => db.recs.filter(r => r.kind === kind && !r.deleted);
const byOrder = (a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || a.createdAt - b.createdAt;
const nextOrder = list => list.reduce((m, x) => Math.max(m, (x.order ?? -1) + 1), 0);
// item을 target 앞/뒤로 옮기고(target 없으면 맨 앞) 순서를 0,1,2…로 다시 매김
function reorder(list, item, target, before) {
  const arr = list.filter(x => x !== item);
  arr.splice(target ? arr.indexOf(target) + (before ? 0 : 1) : 0, 0, item);
  arr.forEach((x, k) => { if (x.order !== k) { x.order = k; touch(x); } });
}
// 이름 비교용: 대소문자·띄어쓰기 무시
const norm = s => s.toLowerCase().replace(/\s+/g, '');

// ---------- 화면 ----------
const $ = id => document.getElementById(id);
function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function button(label, onClick, cls = 'btn') {
  const b = h('button', cls, label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}
function iconBtn(label, title, onClick) {
  const b = button(label, e => { e.stopPropagation(); onClick(); }, 'icon-btn small');
  b.title = title;
  return b;
}
// 자동완성 버튼: 누르는 순간 입력칸이 포커스를 잃지 않게 (잃으면 목록이 닫혀서 클릭이 안 됨)
function suggestBtn(label, onPick, cls = '') {
  const b = button(label, onPick, cls);
  b.addEventListener('pointerdown', e => e.preventDefault());
  return b;
}
// Enter로 추가 (한글 조합 중 Enter는 무시)
function onEnter(input, fn) {
  input.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    fn(text);
  });
}
// Enter = 입력 끝 (change 이벤트로 저장)
function enterBlurs(input) {
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); input.blur(); } });
}
const phone = () => matchMedia('(max-width: 900px)').matches;
let toastTimer;
function toast(text, ms = 2000) {
  $('toast').textContent = text;
  $('toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('show'), ms);
}

// 보기: notes(노트) / meals(식단) / budget(가계부)
// 입력 중이던 칸(data-key)은 다시 그린 뒤에도 글자·커서(선택) 그대로 (동기화로 다시 그려져도)
let focusNext = null; // 다시 그린 뒤 커서를 둘 칸의 data-key (새 묶음 이름 등)
function render() {
  const v = ['meals', 'budget'].includes(prefs.view) ? prefs.view : 'notes';
  document.body.dataset.view = v;
  document.querySelectorAll('#viewSeg [data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  const a = document.activeElement;
  const keep = !focusNext && a && a.dataset && a.dataset.key ? { key: a.dataset.key, value: a.value, pos: a.selectionStart, end: a.selectionEnd } : null;
  if (v === 'meals') renderMeals(); else if (v === 'budget') renderBudget(); else renderNotes();
  const key = focusNext || (keep && keep.key);
  focusNext = null;
  const e = key && document.querySelector(`[data-key="${CSS.escape(key)}"]`);
  if (!e || e === a) return;
  if (keep) e.value = keep.value;
  e.focus();
  if (!keep) e.select();
  else try { e.setSelectionRange(keep.pos, keep.end); } catch { /* 커서 위치를 못 정하는 칸 */ }
}
$('viewSeg').addEventListener('click', e => {
  const b = e.target.closest('[data-view]');
  if (!b) return;
  prefs.view = b.dataset.view;
  savePrefs();
  render();
});

// ---------- 끌어서 순서 바꾸기 ----------
// 손잡이를 눌러 끌기 — 마우스·터치 공통 (폰에서는 HTML 끌어 놓기가 안 돼서 pointer 이벤트로)
// row: 끄는 줄, targets: 놓을 수 있는 곳 선택자, onDrop(놓은 곳, 그 앞이면 true)
function scrollParent(el) {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight) return p;
  }
  return document.scrollingElement;
}
const clearMarks = () => document.querySelectorAll('.drop-before, .drop-after').forEach(x => x.classList.remove('drop-before', 'drop-after'));
function sortable(handle, row, targets, onDrop) {
  handle.addEventListener('pointerdown', e => {
    if (e.button) return;
    e.preventDefault();
    e.stopPropagation();
    handle.setPointerCapture(e.pointerId);
    dragRow(row, targets, onDrop, e);
  });
}
// 끌기: 손잡이를 누르거나(sortable) 폰에서 항목을 길게 누른 뒤(notes.js). start = 누른 곳 { clientX, clientY, pointerId }
function dragRow(row, targets, onDrop, start) {
  row.classList.add('dragging');
  const sc = scrollParent(row), id = start.pointerId;
  let x = start.clientX, y = start.clientY, moved = false, target = null, before = false, raf;
  const mark = () => {
    clearMarks();
    const el = document.elementFromPoint(x, y)?.closest(targets);
    target = el && el !== row && !row.contains(el) ? el : null;
    if (!target) return;
    const r = target.getBoundingClientRect();
    before = y < r.top + r.height / 2;
    target.classList.add(before ? 'drop-before' : 'drop-after');
  };
  // 위·아래 끝 가까이 끌고 있으면 저절로 스크롤
  const tick = () => {
    const r = sc === document.scrollingElement ? { top: 0, bottom: innerHeight } : sc.getBoundingClientRect();
    const d = y < r.top + 50 ? -8 : y > r.bottom - 50 ? 8 : 0;
    if (d && moved) { sc.scrollBy(0, d); mark(); }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  const move = ev => { if (ev.pointerId !== id) return; x = ev.clientX; y = ev.clientY; moved = true; mark(); };
  const end = drop => ev => {
    if (ev.pointerId !== id) return;
    cancelAnimationFrame(raf);
    removeEventListener('pointermove', move);
    removeEventListener('pointerup', up);
    removeEventListener('pointercancel', cancel);
    row.classList.remove('dragging');
    clearMarks();
    if (drop && target) onDrop(target, before);
  };
  const up = end(true), cancel = end(false);
  addEventListener('pointermove', move);
  addEventListener('pointerup', up);
  addEventListener('pointercancel', cancel);
}
function dragHandle() {
  const s = h('span', 'handle', '⋮⋮');
  s.title = '끌어서 순서 바꾸기';
  return s;
}

// ---------- 식단·가계부: 오른쪽 패널 너비 ----------
// 사이 경계(.splitter)를 끌어서 조절, 두 번 누르면 원래대로. prefs.sideW = { meals, budget } (캘린더x플래너와 같은 방식)
function applySideW() {
  for (const s of document.querySelectorAll('.splitter')) {
    const w = (prefs.sideW || {})[s.dataset.split];
    s.parentElement.style.setProperty('--side-w', w ? `${w}px` : '');
  }
}
for (const s of document.querySelectorAll('.splitter')) {
  const key = s.dataset.split;
  s.addEventListener('pointerdown', e => {
    if (e.button) return;
    e.preventDefault();
    s.setPointerCapture(e.pointerId);
    s.classList.add('active');
    const move = ev => {
      const box = s.parentElement.getBoundingClientRect(), right = box.right - 24; // 오른쪽 여백
      const max = Math.max(300, (right - box.left - 24) * 0.6);
      prefs.sideW = { ...prefs.sideW, [key]: Math.round(Math.min(Math.max(right - ev.clientX - 8, 260), max)) };
      applySideW();
    };
    const up = () => {
      s.classList.remove('active');
      s.removeEventListener('pointermove', move);
      s.removeEventListener('pointerup', up);
      s.removeEventListener('pointercancel', up);
      savePrefs();
      render(); // 달력 칸·그래프를 바뀐 너비에 맞게
    };
    s.addEventListener('pointermove', move);
    s.addEventListener('pointerup', up);
    s.addEventListener('pointercancel', up);
  });
  s.addEventListener('dblclick', () => {
    const w = { ...prefs.sideW };
    delete w[key];
    prefs.sideW = w;
    savePrefs();
    applySideW();
    render();
  });
}

// ---------- 설정 ----------
function applyTheme() {
  if (prefs.theme) document.documentElement.dataset.theme = prefs.theme;
  else delete document.documentElement.dataset.theme;
  // 폰 상단 상태바 색을 지금 배경색에 맞춤
  $('themeColor').content = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
const FONT_DEFAULT = 15;
function applyFont() {
  const f = prefs.font || FONT_DEFAULT;
  document.documentElement.style.setProperty('--list-font', `${f}px`);
  $('fontRange').value = f;
  $('fontVal').textContent = `${f}px`;
}
$('fontRange').addEventListener('input', e => { prefs.font = +e.target.value; savePrefs(); applyFont(); });
$('themeSelect').addEventListener('change', e => {
  if (e.target.value) prefs.theme = e.target.value; else delete prefs.theme;
  savePrefs();
  applyTheme();
});
$('themeBtn').addEventListener('click', () => {
  const dark = prefs.theme ? prefs.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  prefs.theme = dark ? 'light' : 'dark';
  savePrefs();
  applyTheme();
});
$('settingsBtn').addEventListener('click', () => {
  $('themeSelect').value = prefs.theme || '';
  $('settings').showModal();
});
$('closeSettingsBtn').addEventListener('click', () => $('settings').close());

// ---------- 백업 ----------
$('exportBtn').addEventListener('click', () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(db)], { type: 'application/json' }));
  a.download = `everyday-backup-${todayStr()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});
$('importFile').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  let data;
  try { data = JSON.parse(await file.text()); } catch { alert('읽을 수 없는 파일이에요.'); return; }
  if (!Array.isArray(data.recs)) { alert('살림노트 백업 파일이 아니에요.'); return; }
  if (!confirm('지금 데이터를 백업 파일 내용으로 바꿀까요?')) return;
  data.owner = db.owner; // 로그인 중이면 지금 계정 데이터로 취급
  data.recs.forEach(touch); // 계정에 있는 값보다 새것으로 → 백업 내용이 이김
  db = data;
  upgradeMenus();
  $('settings').close();
  save();
});

// ---------- 연·월 고르기: 식단·가계부의 달 제목을 누르면 (캘린더x플래너와 같음) ----------
// 보는 달 = 식단은 meals.js 의 view, 가계부는 budget.js 의 bm
const shownMonth = () => (prefs.view === 'budget' ? [+bm.slice(0, 4), +bm.slice(5, 7)] : [view.y, view.m]);
let pickYear, pickerOpen = false;
function renderPicker() {
  const [vy, vm] = shownMonth(), [ty, tm] = ymd(todayStr());
  $('mpYear').textContent = `${pickYear}년`;
  $('mpGrid').replaceChildren(...Array.from({ length: 12 }, (_, i) => button(`${i + 1}월`, () => {
    if (prefs.view === 'budget') bm = `${pickYear}-${pad(i + 1)}`; else view = { y: pickYear, m: i + 1 };
    $('monthPicker').hidePopover();
    render();
  }, (pickYear === vy && i + 1 === vm ? 'on' : '') + (pickYear === ty && i + 1 === tm ? ' now' : ''))));
}
$('monthPicker').addEventListener('beforetoggle', e => {
  if (e.newState !== 'open') return;
  pickYear = shownMonth()[0];
  renderPicker();
  const r = $('monthTitle').getBoundingClientRect();
  $('monthPicker').style.top = `${r.bottom + 6}px`;
  $('monthPicker').style.left = `${Math.min(Math.max(r.left + r.width / 2, 138), innerWidth - 138)}px`; // 창(260px)이 화면 밖으로 안 나가게
});
$('monthPicker').addEventListener('toggle', e => { pickerOpen = e.newState === 'open'; });
$('mpPrev').addEventListener('click', () => { pickYear--; renderPicker(); });
$('mpNext').addEventListener('click', () => { pickYear++; renderPicker(); });

// ---------- 폰: 뒤로 가기 ----------
// 기록을 한 칸 더 쌓아 두고, 뒤로 가기로 그 칸이 빠지면(popstate) 앱 안에서 처리한 뒤 다시 쌓음.
// 닫을 게 없으면 안내만 띄우고 2초 동안 안 쌓음 → 그사이 또 뒤로 가면 앱이 닫힘. (캘린더x플래너와 같은 방식)
if (phone()) {
  const guard = () => history.pushState({ guard: true }, '');
  if (!history.state?.guard) guard();
  let exitTimer = null;
  const rearm = () => { clearTimeout(exitTimer); exitTimer = null; $('toast').classList.remove('show'); guard(); };
  addEventListener('pointerdown', () => { if (exitTimer) rearm(); }); // 안내 중에 화면을 누르면 바로 다시 쌓기
  addEventListener('popstate', () => {
    const dlg = document.querySelector('dialog[open]'), open = document.querySelector('.suggest:not([hidden])');
    if (dlg) dlg.close();
    else if (pickerOpen) $('monthPicker').hidePopover();
    else if (open) document.activeElement.blur();
    else if (prefs.view === 'meals' || prefs.view === 'budget') { prefs.view = 'notes'; savePrefs(); render(); }
    else if (editing) { editing = false; render(); }
    else if (notePage) { notePage = false; render(); }
    else {
      toast('한 번 더 뒤로 가면 종료돼요', 2000);
      exitTimer = setTimeout(rearm, 2000);
      return;
    }
    guard();
  });
}

// 폰은 키보드가 오르내릴 때마다 높이가 바뀜. 그때 다시 그리면 입력 중이던 칸(제목 고치기 등)이 사라지거나
// 커서가 원래 칸으로 되돌아가서 키보드가 다시 올라옴 → 폰은 너비가 바뀔 때만 (폰은 높이에 따라 그리는 게 없음)
let resizeTimer, lastWidth = innerWidth;
addEventListener('resize', () => {
  if (phone() && innerWidth === lastWidth) return;
  lastWidth = innerWidth;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(render, 150);
});
applyTheme();
applyFont();
applySideW();
addEventListener('DOMContentLoaded', render); // notes.js·meals.js 까지 읽은 뒤 그리기

// 앱 설치(PWA)·오프라인용. 파일을 더블클릭해서 연 경우(file://)엔 동작 안 함
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js');
