'use strict';
// 노트: 장보기(shop) / 체크리스트(check) / 메모(memo) / 목록(list: 주제(묶음)별 메모 — 항목 = 제목, 눌러서 내용 entry.memo). 왼쪽 목록 + 오른쪽 내용 (폰은 목록 → 누르면 내용)
// 장보기·체크리스트 = 묶음(note.sections) → 항목(entry). 묶음이 없거나 지워진 항목은 '미분류'
// 장보기: '전체'(늘 사는 것 목록)에서 눌러 need(살 것) 표시 → '살 것'에서 담으면 done → '산 것 정리'로 둘 다 끔
const TYPES = {
  shop: { name: '장보기', color: '#7FCFB8' },
  check: { name: '체크리스트', color: '#F5D27A' },
  memo: { name: '메모', color: '#C7C1B8' },
  list: { name: '목록', color: '#A8C8F0' },
};
// 내 카테고리: 종류와 따로 노트에 붙이는 묶음 { name, color, order }. 노트 색 = 카테고리 색, 없으면 종류 색 (목록 점·체크 칸)
// 기본 팔레트 = 캘린더x플래너 카테고리 색에서 10개. ＋로 고른 색은 끝에 더하고, 길게 누르면 지움 → 계정에 저장 (id 고정 rec 하나)
const NOTE_COLORS = ['#F4978E', '#F8B88B', '#F5D27A', '#9FCB8E', '#7FCFB8', '#84CDE0', '#8DB6F2', '#B99AF0', '#F3A6C8', '#C7C1B8'];
const PALETTE_ID = 'note-colors';
const notePalette = () => (recs('palette').find(r => r.id === PALETTE_ID) || {}).colors || NOTE_COLORS;
function setNotePalette(colors) { // 저장은 부르는 쪽에서
  let r = db.recs.find(x => x.id === PALETTE_ID);
  if (!r) { r = { ...newRec('palette', {}), id: PALETTE_ID }; db.recs.push(r); }
  r.colors = colors;
  touch(r);
}
const noteCats = () => recs('notecat').sort(byOrder);
const noteCatOf = n => noteCats().find(c => c.id === n.cat) || null;
const noteColor = n => (noteCatOf(n) || TYPES[n.type]).color;
function setCatOpen(id, open) {
  const o = { ...prefs.catOpen };
  if (open) o[id] = true; else delete o[id];
  prefs.catOpen = o;
  savePrefs();
}
async function addNoteCat() { // 저장은 부르는 쪽에서
  const name = await ask('새 카테고리 이름');
  if (!name) return null;
  const cats = noteCats(), used = cats.map(c => c.color), pal = notePalette();
  const c = newRec('notecat', { name, color: pal.find(x => !used.includes(x)) || pal[0] || NOTE_COLORS[0], order: nextOrder(cats) });
  db.recs.push(c);
  return c;
}
const notes = () => recs('note').sort(byOrder);
const entriesOf = n => recs('entry').filter(e => e.note === n.id).sort(byOrder);
const secOf = (n, e) => (n.sections.some(s => s.id === e.section) ? e.section : null);
const entriesIn = (n, sec) => entriesOf(n).filter(e => secOf(n, e) === sec);
const toBuy = e => e.need && !e.done;
// 이름이 같은 항목 ('두부' → '두부/순두부'처럼 / 로 나눈 이름 중 하나가 같아도)
function findEntry(n, name) {
  const q = norm(name), list = entriesOf(n);
  return list.find(e => norm(e.text) === q) || list.find(e => e.text.split('/').some(p => norm(p) === q)) || null;
}
function addEntry(n, section, text, fields) {
  db.recs.push(newRec('entry', { note: n.id, section, text, done: false, need: false, order: nextOrder(entriesIn(n, section)), ...fields }));
}
// 묶음을 안 정하고 새로 넣는 항목(살 것 추가, 레시피 재료)이 갈 곳: '기타' 묶음이 있으면 거기, 없으면 미분류
const looseSection = n => (n.sections.find(s => s.name.trim() === '기타') || {}).id || null;

let notePage = false; // 폰: 노트 안을 보는 중 (false면 목록)
let editing = false;  // 편집 중: 이름 고치기·순서 바꾸기·지우기
const openMemos = new Set(); // 목록: 내용을 펴 둔 항목 (앱을 켜 둔 동안)
const currentNote = () => { const list = notes(); return list.find(n => n.id === prefs.note) || list[0] || null; };
// 장보기 보기: need(살 것) / all(전체). 편집 중엔 전체. 고른 적 없으면 살 것이 있을 때만 '살 것'
const tabOf = n => (n.type === 'shop' && !editing
  ? (prefs.tab || {})[n.id] || (entriesOf(n).some(e => e.need) ? 'need' : 'all') : 'all');

function openNote(n) {
  if (prefs.note !== n.id) editing = false;
  prefs.note = n.id;
  savePrefs();
  notePage = true;
  render();
  $('note').scrollTop = 0;
  if (phone()) scrollTo(0, 0);
}
$('backBtn').addEventListener('click', () => { notePage = false; editing = false; render(); });

function renderNotes() {
  const cur = currentNote(), list = notes();
  document.body.dataset.page = phone() && notePage && cur ? 'note' : 'list';
  // 카테고리 없는 노트가 위, 그 아래 카테고리별로 (빈 카테고리도 제목은 보여줌: 끌어 놓을 곳)
  const out = list.filter(n => !noteCatOf(n)).map(n => noteRow(n, n === cur));
  // 카테고리 제목을 누르면 접기·펼치기. 처음엔 접힘, 펼친 카테고리만 기기별로 기억 (prefs.catOpen)
  for (const c of noteCats()) {
    const inCat = list.filter(n => n.cat === c.id), folded = !(prefs.catOpen || {})[c.id];
    const head = h('div', 'note-cat' + (folded ? ' folded' : ''));
    head.append(h('span', 'fold', '▾'), h('span', 'name', c.name), h('span', 'count', inCat.length || ''),
      iconBtn('＋', `‘${c.name}’에 새 노트`, () => openNewNote(c)));
    head.style.setProperty('--c', c.color); // 제목 음영 = 카테고리 색
    head.dataset.cat = c.id;
    head.title = folded ? '펼치기' : '접기';
    head.addEventListener('click', () => { setCatOpen(c.id, folded); render(); });
    out.push(head, ...(folded ? [] : inCat.map(n => noteRow(n, n === cur))));
  }
  $('noteList').replaceChildren(...(list.length ? out : [h('p', 'hint', '‘+ 새 노트’로 장보기·체크리스트·메모를 만들어요.')]));
  renderNote(cur);
}

function noteCount(n) {
  if (n.type === 'memo') return '';
  const list = entriesOf(n);
  if (n.type === 'shop') { const k = list.filter(toBuy).length; return k ? `살 것 ${k}` : ''; }
  if (n.type === 'list') return list.length || '';
  return list.length ? `${list.filter(e => e.done).length}/${list.length}` : '';
}
function noteRow(n, on) {
  const row = h('div', 'note-row' + (on ? ' on' : ''));
  row.dataset.id = n.id;
  row.style.setProperty('--c', noteColor(n));
  const handle = dragHandle(), tools = h('span', 'note-tools');
  tools.append(iconBtn('✕', '노트 삭제', () => deleteNote(n)));
  row.append(handle, h('span', 'note-name', n.title || '제목 없음'), h('span', 'count', noteCount(n)), tools);
  row.addEventListener('click', e => { if (!e.target.closest('.handle')) openNote(n); });
  // 다른 카테고리의 노트 위에 놓으면 그 카테고리로, 카테고리 제목에 놓으면 그 카테고리 맨 위로
  const drop = (t, before) => {
    const catId = x => (noteCatOf(x) || {}).id || null;
    let target = notes().find(x => x.id === t.dataset.id), cat = target && catId(target);
    if (!target) {
      cat = t.dataset.cat;
      target = notes().find(x => x !== n && x.cat === cat); // 그 카테고리의 첫 노트 앞 (비어 있으면 자리는 그대로)
      before = true;
    }
    if (catId(n) !== cat) { n.cat = cat; touch(n); }
    if (target) reorder(notes(), n, target, before);
    save();
  };
  sortable(handle, row, '.note-row, .note-cat', drop);
  // PC는 마우스를 올리면 개수 자리에 ✕. 폰은 길게 누르면 ✕ (다른 데를 누르면 닫힘), 손을 떼지 않고 끌면 옮기기
  longPress(row, start => {
    row.classList.add('show-tools');
    const close = ev => {
      if (row.contains(ev.target)) return;
      row.classList.remove('show-tools');
      removeEventListener('pointerdown', close, true);
    };
    addEventListener('pointerdown', close, true);
    dragRow(row, '.note-row, .note-cat', drop, start);
  });
  return row;
}

function renderNote(n) {
  const box = $('note');
  if (!n) {
    const e = h('div', 'note-empty');
    e.append(h('p', '', '아직 노트가 없어요.'),
      h('p', 'hint', '왼쪽 ‘+ 새 노트’로 장보기·체크리스트·메모를 만들어요.'));
    box.replaceChildren(e);
    return;
  }
  box.style.setProperty('--c', noteColor(n)); // 체크 칸 색
  box.replaceChildren(noteHead(n), ...(n.type === 'memo' ? [memoBody(n)] : listBody(n)));
}

// ---------- 머리: 이름, 보기 전환, 정리·해제, 편집 ----------
function noteHead(n) {
  const head = h('div', 'note-head');
  const top = h('div', 'note-top');
  top.append(titleEl(n));
  if (n.type !== 'memo' && !editing) {
    const list = entriesOf(n);
    if (n.type === 'shop') {
      const seg = h('div', 'seg');
      for (const [k, label] of [['need', `살 것 ${list.filter(toBuy).length}`], ['all', `전체 ${list.length}`]]) {
        const b = button(label, () => { prefs.tab = { ...prefs.tab, [n.id]: k }; savePrefs(); render(); }, tabOf(n) === k ? 'on' : '');
        seg.append(b);
      }
      top.append(seg);
      const got = list.filter(e => e.need && e.done);
      if (tabOf(n) === 'need' && got.length) {
        const b = button(`산 것 정리 ${got.length}`, () => {
          got.forEach(e => { e.need = false; e.done = false; touch(e); });
          save();
          toast('담은 것을 살 것에서 뺐어요');
        });
        b.title = '담은(체크한) 항목을 살 것에서 빼요. 전체 목록에는 그대로 있어요';
        top.append(b);
      }
    } else if (n.type === 'check') {
      const done = list.filter(e => e.done);
      if (done.length) top.append(button('모두 해제', () => {
        if (!confirm(`체크 ${done.length}개를 모두 해제할까요?`)) return;
        done.forEach(e => { e.done = false; touch(e); });
        save();
      }));
    }
  }
  top.append(button(editing ? '완료' : '편집', () => { editing = !editing; render(); }, editing ? 'btn primary' : 'btn'));
  head.append(top);
  if (editing) head.append(editBar(n));
  return head;
}

// 이름: 글자로 보여주고 누르면 입력칸으로
function titleEl(n) {
  const t = h('h2', 'note-title', n.title || '제목 없음');
  t.title = '눌러서 이름 바꾸기';
  t.addEventListener('click', () => {
    const input = h('input', 'note-title');
    input.value = n.title;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      const v = input.value.trim();
      if (v && v !== n.title) { n.title = v; touch(n); save(); } else render();
    };
    input.addEventListener('blur', finish);
    input.enterKeyHint = 'done'; // 폰 키보드에 '다음' 대신 '완료'
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { input.value = n.title; input.blur(); }
    });
    t.replaceWith(input);
    input.focus();
    input.select();
  });
  return t;
}

function editBar(n) {
  const bar = h('div', 'edit-bar');
  const cs = h('select'); // 카테고리
  for (const [v, label] of [['', '카테고리 없음'], ...noteCats().map(c => [c.id, c.name]), ['+', '+ 새 카테고리…']]) {
    const o = h('option', '', label);
    o.value = v;
    cs.append(o);
  }
  cs.value = (noteCatOf(n) || {}).id || '';
  cs.title = '카테고리 (설정 › 노트 › 카테고리 편집에서 이름·색 바꾸기)';
  cs.addEventListener('change', async () => {
    const c = cs.value === '+' ? await addNoteCat() : noteCats().find(x => x.id === cs.value) || null;
    if (cs.value === '+' && !c) { cs.value = (noteCatOf(n) || {}).id || ''; return; }
    n.cat = c ? c.id : null;
    if (c) setCatOpen(c.id, true); // 옮긴 노트가 목록에서 안 보이지 않게
    touch(n);
    save();
  });
  bar.append(cs);
  if (n.type !== 'memo') {
    const sel = h('select');
    for (const t of ['shop', 'check', 'list']) { const o = h('option', '', TYPES[t].name); o.value = t; sel.append(o); }
    sel.value = n.type;
    sel.title = '노트 종류';
    sel.addEventListener('change', () => { n.type = sel.value; touch(n); save(); });
    bar.append(sel, button('+ 묶음', () => {
      const s = { id: uid(), name: '새 묶음' };
      n.sections = [...n.sections, s];
      touch(n);
      focusNext = `sec:${s.id}`;
      save();
    }));
  }
  bar.append(h('span', 'spacer'), button('복사', () => copyNote(n)), button('노트 삭제', () => deleteNote(n), 'btn danger'));
  return bar;
}
// 설정 › 노트 › 카테고리 편집: 색(점을 누르면 고르기)·이름 바꾸기·지우기 (지우면 그 노트들은 카테고리 없음)
let pickingCat = null, addingColor = false; // 색 고르는 중인 카테고리, 팔레트의 ＋(색 더하기)를 펼쳤는지
function renderNoteCats() {
  const out = [], dot = (color, onClick, on) => {
    const b = button('', onClick, 'cat-dot' + (on ? ' on' : ''));
    b.style.setProperty('--c', color);
    return b;
  };
  for (const c of noteCats()) {
    const n = notes().filter(x => x.cat === c.id).length, row = h('div', 'row cat-row'), handle = dragHandle();
    row.dataset.id = c.id;
    // 끌어서 순서 바꾸기 = 노트 목록의 카테고리 순서
    sortable(handle, row, '#noteCatManage .cat-row', (t, before) => {
      reorder(noteCats(), c, noteCats().find(x => x.id === t.dataset.id), before);
      save();
      renderNoteCats();
    });
    const d = dot(c.color, () => { pickingCat = pickingCat === c.id ? null : c.id; addingColor = false; renderNoteCats(); }, pickingCat === c.id);
    d.title = '색 바꾸기';
    row.append(handle, d, h('span', 'cat-name', c.name), h('span', 'hint', `노트 ${n}`), iconBtn('✎', '이름 바꾸기', async () => {
      const name = await ask('카테고리 이름', c.name);
      if (!name || name === c.name) return;
      c.name = name;
      touch(c);
      save();
      renderNoteCats();
    }), iconBtn('✕', '카테고리 지우기', () => {
      if (!confirm(`‘${c.name}’ 카테고리를 지울까요?` + (n ? `\n노트 ${n}개는 카테고리 없이 남아요.` : ''))) return;
      notes().filter(x => x.cat === c.id).forEach(x => { x.cat = null; touch(x); });
      remove(c);
      save();
      renderNoteCats();
    }));
    out.push(row);
    if (pickingCat === c.id) {
      const pal = h('div', 'palette'), pick = col => { c.color = col; touch(c); pickingCat = null; save(); renderNoteCats(); };
      const same = (a, b) => a.toLowerCase() === b.toLowerCase();
      pal.append(...notePalette().map(col => {
        const d = dot(col, () => pick(col), same(col, c.color));
        d.title = '길게 누르면 (PC는 오른쪽 클릭도) 팔레트에서 지우기';
        holdPress(d, () => {
          if (!confirm('이 색을 팔레트에서 지울까요?\n이 색을 쓰는 카테고리는 그대로예요.')) return;
          setNotePalette(notePalette().filter(x => x !== col));
          save();
          renderNoteCats();
        });
        return d;
      }));
      const custom = button('+', () => { addingColor = !addingColor; renderNoteCats(); }, 'cat-dot custom' + (addingColor ? ' on' : ''));
      custom.title = '색 더하기';
      pal.append(custom);
      out.push(pal);
      if (addingColor) out.push(colorAdder(col => {
        if (!notePalette().some(x => same(x, col))) setNotePalette([...notePalette(), col]);
        pick(col);
      }));
    }
  }
  if (!out.length) out.push(h('p', 'hint', '카테고리를 만들어 노트에 붙이면 (노트 › 편집) 목록이 카테고리별로 묶이고 그 색이 돼요.'));
  out.push(button('+ 카테고리', async () => { if (await addNoteCat()) { save(); renderNoteCats(); } }));
  $('noteCatManage').replaceChildren(...out);
}
// 팔레트의 ＋: 예시(팔레트에 아직 없는 것)를 누르거나 색 코드를 넣어 더하기 → add(색), 바꾼 팔레트는 기본 색으로 되돌리기
// rerender = 되돌린 뒤 다시 그릴 창 (냉장고 › 재료 종류 편집도 같은 팔레트를 씀)
const COLOR_IDEAS = ['#C98B6B', '#D4B062', '#6F9C95', '#7F9CB7', '#A88BA8']; // 테라코타·머스터드·틸·더스티 블루·모브
function colorAdder(add, rerender = renderNoteCats) {
  const box = h('div', 'color-add'), ideas = h('div', 'color-ideas'), row = h('div', 'color-code');
  ideas.append(...COLOR_IDEAS.filter(x => !notePalette().includes(x)).map(col => {
    const d = button('', () => add(col), 'cat-dot');
    d.style.setProperty('--c', col);
    d.title = col;
    return d;
  }));
  const prev = h('span', 'cat-dot preview'), input = h('input', 'text-input');
  input.placeholder = '색 코드 (#A1B2C3)';
  input.maxLength = 7;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.enterKeyHint = 'done';
  const code = () => { const v = input.value.trim().replace(/^#/, ''); return /^[0-9a-f]{6}$/i.test(v) ? `#${v.toUpperCase()}` : null; };
  input.addEventListener('input', () => { input.classList.remove('bad'); prev.style.setProperty('--c', code() || 'transparent'); });
  const ok = () => { if (code()) add(code()); else input.classList.add('bad'); };
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) ok(); });
  row.append(prev, input, button('더하기', ok, 'btn small'));
  box.append(ideas, row);
  // 팔레트를 바꿨을 때만: 기본 10색으로 (카테고리에 칠한 색은 그대로)
  if (notePalette().join() !== NOTE_COLORS.join()) box.append(button('기본 색으로 되돌리기', () => {
    if (!confirm('팔레트를 기본 10색으로 되돌릴까요?\n더하거나 지운 색은 원래대로 되고, 카테고리 색은 그대로예요.')) return;
    setNotePalette([...NOTE_COLORS]);
    save();
    rerender();
  }, 'btn small reset'));
  return box;
}
// 설정 › 노트 › 카테고리 편집 (따로 여는 창)
$('noteCatsBtn').addEventListener('click', () => {
  $('settings').close();
  pickingCat = null;
  addingColor = false;
  renderNoteCats();
  $('noteCats').showModal();
});
$('noteCatsClose').addEventListener('click', () => $('noteCats').close());

// 복사본은 체크를 다 푼 상태로 (여행 짐 → '10월 제주' 같은 새 목록)
function copyNote(n) {
  const c = newRec('note', { type: n.type, cat: n.cat || null, title: `${n.title} 복사`, text: n.text || '', order: nextOrder(notes()) });
  const ids = {};
  c.sections = n.sections.map(s => { ids[s.id] = uid(); return { id: ids[s.id], name: s.name }; });
  db.recs.push(c);
  for (const e of entriesOf(n)) {
    db.recs.push(newRec('entry', { note: c.id, section: ids[e.section] || null, text: e.text, done: false, need: !!e.need, order: e.order,
      ...(e.memo ? { memo: e.memo } : {}) }));
  }
  prefs.note = c.id;
  savePrefs();
  editing = false;
  save();
  toast('복사했어요. 이름을 눌러 바꿔요');
}
function deleteNote(n) {
  if (!confirm(`‘${n.title}’ 노트를 지울까요?`)) return;
  entriesOf(n).forEach(remove);
  remove(n);
  editing = false;
  notePage = false;
  save();
}

// ---------- 메모 ----------
function memoBody(n) {
  const ta = h('textarea', 'memo-text');
  ta.value = n.text || '';
  ta.placeholder = '자유롭게 적어요';
  ta.dataset.key = `memo:${n.id}`;
  // 쓰는 동안 다시 그리지 않고 저장만 (0.5초 멈추면)
  let timer;
  const flush = () => {
    clearTimeout(timer);
    if (ta.value === (n.text || '')) return;
    n.text = ta.value;
    touch(n);
    persist();
    if (window.onSave) window.onSave();
  };
  ta.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(flush, 500); });
  ta.addEventListener('blur', flush);
  return ta;
}

// ---------- 장보기·체크리스트 ----------
// mode: need(살 것) / all(장보기 전체) / check(체크리스트) / edit(편집)
function listBody(n) {
  const mode = editing ? 'edit' : n.type === 'check' || n.type === 'list' ? n.type : tabOf(n);
  const all = entriesOf(n), out = [];
  if (mode === 'need') out.push(shopAdder(n));
  for (const s of [...n.sections, null]) {
    let list = all.filter(e => secOf(n, e) === (s ? s.id : null));
    if (mode === 'need') list = list.filter(e => e.need);
    if (mode === 'need' || mode === 'check') list = [...list.filter(e => !e.done), ...list.filter(e => e.done)]; // 체크한 건 아래로
    if (mode === 'need' && !list.length) continue;
    if (!s && !list.length && n.sections.length) continue; // '미분류'는 항목 있을 때만
    out.push(section(n, s, list, mode));
  }
  if (mode === 'need' && !all.some(e => e.need)) out.push(h('p', 'hint center', '살 것이 없어요. 위에 적거나, ‘전체’에서 눌러 표시해요.'));
  if (mode !== 'need' && !all.length && !n.sections.length) {
    out.push(h('p', 'hint', n.type === 'list'
      ? '메모 제목을 적고 Enter, 눌러서 내용을 적어요. ‘편집 → + 묶음’으로 주제를 나눠요.'
      : '항목을 적고 Enter. ‘편집 → + 묶음’으로 세안·옷처럼 나눌 수 있어요.'));
  }
  return out;
}

function section(n, s, list, mode) {
  // 묶음은 처음엔 접힘. 펼친 묶음만 기기별로 기억 (prefs.secOpen). 편집 중엔 모두 펼침
  // 묶음이 없는 노트는 제목 줄이 없어서 접을 수 없음 → 항상 펼침
  const sid = s ? s.id : null, foldKey = sid || `none:${n.id}`, hasHead = !!(s || n.sections.length);
  const folded = hasHead && mode !== 'edit' && !(prefs.secOpen || {})[foldKey];
  const box = h('div', 'sec' + (folded ? ' folded' : ''));
  box.dataset.sec = sid || '';
  if (hasHead) {
    const head = h('div', 'sec-head');
    head.dataset.sec = sid || '';
    if (mode === 'edit' && s) {
      const handle = dragHandle(), name = h('input', 'sec-name');
      name.value = s.name;
      name.dataset.key = `sec:${s.id}`;
      name.addEventListener('change', () => { s.name = name.value.trim() || s.name; touch(n); save(); });
      enterBlurs(name);
      head.append(handle, name, h('span', 'count', list.length), iconBtn('✕', '묶음 삭제', () => {
        const inside = entriesIn(n, s.id);
        if (inside.length && !confirm(`‘${s.name}’ 묶음과 항목 ${inside.length}개를 지울까요?`)) return;
        inside.forEach(remove);
        n.sections = n.sections.filter(x => x !== s);
        touch(n);
        save();
      }));
      sortable(handle, box, '.sec[data-sec]:not([data-sec=""])', (t, before) => {
        const arr = n.sections.filter(x => x !== s), target = arr.find(x => x.id === t.dataset.sec);
        arr.splice(arr.indexOf(target) + (before ? 0 : 1), 0, s);
        n.sections = arr;
        touch(n);
        save();
      });
    } else {
      const done = list.filter(e => e.done).length;
      const count = mode === 'need' || mode === 'check' ? `${done}/${list.length}` : list.length;
      head.append(h('span', 'fold', '▾'), h('span', 'sec-name', s ? s.name : '미분류'), h('span', 'count', count));
      if (mode !== 'edit') {
        head.title = folded ? '펼치기' : '접기';
        head.addEventListener('click', () => {
          const o = { ...prefs.secOpen };
          if (folded) o[foldKey] = true; else delete o[foldKey];
          prefs.secOpen = o;
          savePrefs();
          render();
        });
      }
    }
    box.append(head);
  }
  if (!folded) {
    const ul = h('ul', 'entries');
    ul.append(...list.map(e => entryRow(n, e, mode)));
    box.append(ul);
    if (mode !== 'need') box.append(addInput(n, sid));
  }
  return box;
}

function entryRow(n, e, mode) {
  const li = h('li', 'entry');
  li.dataset.id = e.id;
  if (mode === 'edit') {
    li.classList.add('edit');
    const handle = dragHandle(), input = h('input', 'entry-input');
    input.value = e.text;
    input.dataset.key = `entry:${e.id}`;
    input.addEventListener('change', () => {
      const v = input.value.trim();
      if (!v) { input.value = e.text; return; }
      e.text = v;
      touch(e);
      save();
    });
    enterBlurs(input);
    li.append(handle, input, iconBtn('✕', '항목 삭제', () => { remove(e); save(); }));
    sortable(handle, li, '.entry, .sec-head', (t, before) => dropEntry(n, e, t, before));
    return li;
  }
  // 목록 = 눌러서 내용 펴기·접기, 전체(장보기) = 눌러서 살 것 표시, 그 밖 = 눌러서 체크
  const shopAll = mode === 'all', isList = mode === 'list', open = isList && openMemos.has(e.id);
  if (isList) {
    li.classList.add('memo-item');
    li.classList.toggle('open', open);
    li.append(h('span', 'fold', '▾'), h('span', 'text', e.text));
    if (!open && e.memo) li.append(h('span', 'memo-preview', e.memo.split('\n').find(l => l.trim()) || ''));
  } else {
    li.classList.toggle(shopAll ? 'need' : 'done', !!(shopAll ? e.need : e.done));
    li.append(h('span', shopAll ? 'mark' : 'check'), h('span', 'text', e.text));
  }
  li.title = shopAll ? (e.need ? '눌러서 살 것에서 빼기' : '눌러서 살 것으로 표시') : '';
  // 마우스를 올리면 오른쪽에 ✎ 이름 바꾸기 · ✕ 삭제 (편집을 안 눌러도). 항목을 누른 채 끌면 순서·묶음 옮기기
  // '살 것'은 걸러 본 목록이라 ✎만, 끌기도 없음
  const tools = h('span', 'entry-tools');
  tools.append(iconBtn('✎', '이름 바꾸기', () => editText(li, e)));
  if (mode !== 'need') {
    tools.append(iconBtn('✕', '항목 삭제', () => { remove(e); save(); }));
    dragByMouse(li, '.entry, .sec-head', (t, before) => dropEntry(n, e, t, before));
  }
  li.append(tools);
  if (open) li.append(memoArea(e));
  // 폰: 길게 누르면 ✎ ✕ 를 보여주고 (다른 데를 누르면 닫힘), 손을 떼지 않고 끌면 다른 자리·묶음으로 옮김
  longPress(li, start => {
    li.classList.add('show-tools');
    const close = ev => {
      if (li.contains(ev.target)) return;
      li.classList.remove('show-tools');
      removeEventListener('pointerdown', close, true);
    };
    addEventListener('pointerdown', close, true);
    if (mode !== 'need') dragRow(li, '.entry, .sec-head', (t, before) => dropEntry(n, e, t, before), start);
  });
  li.addEventListener('click', () => {
    if (li.classList.contains('editing')) return;
    if (isList) {
      if (open) openMemos.delete(e.id); else openMemos.add(e.id);
      render();
      return;
    }
    // 전체에서 표시하는 중에 '살 것'으로 넘어가지 않게 지금 보기를 고정
    if (shopAll && !(prefs.tab || {})[n.id]) { prefs.tab = { ...prefs.tab, [n.id]: 'all' }; savePrefs(); }
    if (shopAll) { e.need = !e.need; e.done = false; } else e.done = !e.done;
    touch(e);
    save();
  });
  return li;
}
// 편집: 항목을 다른 항목 앞/뒤나 묶음 머리(맨 위)에 놓기
function dropEntry(n, e, t, before) {
  if (t.classList.contains('sec-head')) {
    e.section = t.dataset.sec || null;
    reorder(entriesIn(n, e.section), e, null, true);
  } else {
    const target = recs('entry').find(x => x.id === t.dataset.id);
    if (!target) return;
    e.section = secOf(n, target);
    reorder(entriesIn(n, e.section), e, target, before);
  }
  touch(e);
  save();
}

// 목록 항목의 내용: 쓰는 동안 다시 그리지 않고 저장만 (0.5초 멈추면, 메모와 같음)
function memoArea(e) {
  const ta = h('textarea', 'entry-memo');
  ta.value = e.memo || '';
  ta.placeholder = '내용';
  ta.dataset.key = `memo-entry:${e.id}`;
  const fit = () => { ta.rows = Math.max(3, ta.value.split('\n').length + 1); };
  fit();
  let timer;
  const flush = () => {
    clearTimeout(timer);
    if (ta.value === (e.memo || '')) return;
    e.memo = ta.value;
    touch(e);
    persist();
    if (window.onSave) window.onSave();
  };
  ta.addEventListener('input', () => { fit(); clearTimeout(timer); timer = setTimeout(flush, 500); });
  ta.addEventListener('blur', flush);
  ta.addEventListener('click', ev => ev.stopPropagation());
  return ta;
}
// 길게 누르기 (터치): 0.5초 동안 거의 안 움직이면 fn(누른 곳 { clientX, clientY, pointerId }).
// 그 뒤에 오는 click(체크 등)은 막고, 그대로 움직여도 화면은 스크롤되지 않게 (끌기로 씀)
function longPress(el, fn) {
  let timer = null, fired = false, x = 0, y = 0, id = null;
  const cancel = () => clearTimeout(timer);
  el.addEventListener('pointerdown', e => {
    fired = false;
    if (e.pointerType !== 'touch' || e.target.closest('input, textarea, button, .handle')) return;
    x = e.clientX;
    y = e.clientY;
    id = e.pointerId;
    cancel();
    timer = setTimeout(() => { fired = true; fn({ clientX: x, clientY: y, pointerId: id }); }, 500);
  });
  el.addEventListener('touchmove', e => { if (fired && e.cancelable) e.preventDefault(); }, { passive: false });
  el.addEventListener('pointermove', e => { if (Math.hypot(e.clientX - x, e.clientY - y) > 8) cancel(); });
  el.addEventListener('pointerup', cancel);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('contextmenu', e => { if (fired) e.preventDefault(); });
  el.addEventListener('click', e => { if (fired) { fired = false; e.stopImmediatePropagation(); } }, true);
}
// 버튼 길게 누르기 (0.5초, 터치·마우스 공통) 또는 오른쪽 클릭 → fn.
// 그 뒤 손을 뗄 때 오는 click·contextmenu(폰은 길게 누르면 옴)는 다음에 누를 때까지 막음 — fn이 다시 그려서 그 자리에 다른 버튼이 와도
function holdPress(el, fn) {
  let timer = null;
  const types = ['click', 'contextmenu'], block = e => { e.preventDefault(); e.stopPropagation(); };
  const fire = () => {
    clearTimeout(timer);
    types.forEach(t => addEventListener(t, block, true));
    addEventListener('pointerdown', () => types.forEach(t => removeEventListener(t, block, true)), { capture: true, once: true });
    fn();
  };
  el.addEventListener('pointerdown', e => { if (e.button === 0) timer = setTimeout(fire, 500); });
  for (const t of ['pointerup', 'pointerleave', 'pointercancel']) el.addEventListener(t, () => clearTimeout(timer));
  el.addEventListener('contextmenu', e => { e.preventDefault(); fire(); });
}
// 항목 이름을 그 자리에서 입력칸으로 (Enter·칸 밖 = 저장, Esc = 취소)
function editText(li, e) {
  const input = h('input', 'entry-input');
  input.value = e.text;
  let finished = false;
  const finish = ok => {
    if (finished) return;
    finished = true;
    const v = input.value.trim();
    if (ok && v && v !== e.text) { e.text = v; touch(e); save(); } else render();
  };
  input.addEventListener('click', ev => ev.stopPropagation());
  input.enterKeyHint = 'done'; // 폰 키보드에 '다음' 대신 '완료'
  input.addEventListener('keydown', ev => {
    if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); finish(true); }
    if (ev.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
  li.classList.add('editing');
  li.querySelector('.text').replaceWith(input);
  input.focus();
  input.select();
}
function addInput(n, sec) {
  const input = h('input', 'add-input');
  input.placeholder = '+ 항목 추가';
  input.autocomplete = 'off';
  input.dataset.key = `add:${n.id}:${sec || ''}`;
  onEnter(input, text => { addEntry(n, sec, text); save(); });
  return input;
}

// 살 것 추가: 적으면 전체 목록에서 찾아 보여줌 → 누르면 살 것 표시, 없으면 새로 ('기타' 묶음이나 미분류에)
function shopAdder(n) {
  const wrap = h('div', 'suggest-wrap shop-add'), input = h('input', 'add-input'), box = h('div', 'suggest');
  input.placeholder = '+ 살 것 추가 (목록에서 찾기)';
  input.autocomplete = 'off';
  input.dataset.key = `shop:${n.id}`;
  box.hidden = true;
  const mark = e => { e.need = true; e.done = false; touch(e); input.value = ''; box.hidden = true; save(); };
  const create = text => { input.value = ''; box.hidden = true; addEntry(n, looseSection(n), text, { need: true }); save(); };
  input.addEventListener('input', () => {
    const text = input.value.trim(), q = norm(text);
    if (!q) { box.hidden = true; return; }
    const starts = e => (e.text.split('/').some(p => norm(p).startsWith(q)) ? 0 : 1); // 앞부분이 맞는 것 먼저
    const hits = entriesOf(n).filter(e => !toBuy(e) && norm(e.text).includes(q)).sort((a, b) => starts(a) - starts(b)).slice(0, 8);
    box.replaceChildren(...hits.map(e => suggestBtn(e.text, () => mark(e))));
    if (!findEntry(n, text)) box.append(suggestBtn(`‘${text}’ 새로 추가`, () => create(text), 'new'));
    box.hidden = false;
  });
  input.addEventListener('blur', () => { box.hidden = true; });
  onEnter(input, text => {
    const e = findEntry(n, text);
    if (e) mark(e); else create(text);
  });
  wrap.append(input, box);
  return wrap;
}

// ---------- 새 노트 ----------
let newType = 'check';
let newCat = null; // 카테고리 제목의 ＋로 열면 그 카테고리
const syncTypePick = () => document.querySelectorAll('#typePick [data-type]').forEach(b => b.classList.toggle('on', b.dataset.type === newType));
$('typePick').addEventListener('click', e => {
  const b = e.target.closest('[data-type]');
  if (b) { newType = b.dataset.type; syncTypePick(); }
});
function openNewNote(cat) {
  newType = notes().some(n => n.type === 'shop') ? 'check' : 'shop';
  $('newNoteForm').reset();
  newCat = cat ? cat.id : null;
  $('newNoteForm').title.placeholder = cat ? `노트 이름 (${cat.name})` : '노트 이름';
  syncTypePick();
  $('newNote').showModal();
}
$('addNoteBtn').addEventListener('click', () => openNewNote(null));
$('newNoteCancel').addEventListener('click', () => $('newNote').close());
$('newNoteForm').addEventListener('submit', e => {
  e.preventDefault();
  const n = newRec('note', { type: newType, cat: newCat, title: e.target.title.value.trim(), sections: [], text: '', order: nextOrder(notes()) });
  db.recs.push(n);
  prefs.note = n.id;
  if (n.type === 'shop') prefs.tab = { ...prefs.tab, [n.id]: 'all' }; // 처음엔 늘 사는 것 목록부터
  if (n.cat) setCatOpen(n.cat, true);
  savePrefs();
  editing = false;
  notePage = true;
  $('newNote').close();
  if (n.type !== 'memo') focusNext = `add:${n.id}:`;
  save();
});
