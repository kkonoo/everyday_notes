'use strict';
// 노트: 장보기(shop) / 체크리스트(check) / 메모(memo). 왼쪽 목록 + 오른쪽 내용 (폰은 목록 → 누르면 내용)
// 장보기·체크리스트 = 묶음(note.sections) → 항목(entry). 묶음이 없거나 지워진 항목은 '미분류'
// 장보기: '전체'(늘 사는 것 목록)에서 눌러 need(살 것) 표시 → '살 것'에서 담으면 done → '산 것 정리'로 둘 다 끔
const TYPES = {
  shop: { name: '장보기', color: '#7FCFB8' },
  check: { name: '체크리스트', color: '#F5D27A' },
  memo: { name: '메모', color: '#C7C1B8' },
};
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
  $('noteList').replaceChildren(...(list.length ? list.map(n => noteRow(n, n === cur))
    : [h('p', 'hint', '‘+ 새 노트’로 장보기·체크리스트·메모를 만들어요.')]));
  renderNote(cur);
}

function noteCount(n) {
  if (n.type === 'memo') return '';
  const list = entriesOf(n);
  if (n.type === 'shop') { const k = list.filter(toBuy).length; return k ? `살 것 ${k}` : ''; }
  return list.length ? `${list.filter(e => e.done).length}/${list.length}` : '';
}
function noteRow(n, on) {
  const row = h('div', 'note-row' + (on ? ' on' : ''));
  row.dataset.id = n.id;
  row.style.setProperty('--c', TYPES[n.type].color);
  const handle = dragHandle();
  row.append(h('span', 'dot'), h('span', 'note-name', n.title || '제목 없음'), h('span', 'count', noteCount(n)), handle);
  row.addEventListener('click', e => { if (!e.target.closest('.handle')) openNote(n); });
  sortable(handle, row, '.note-row', (t, before) => {
    reorder(notes(), n, notes().find(x => x.id === t.dataset.id), before);
    save();
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
    } else {
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
  if (n.type !== 'memo') {
    const sel = h('select');
    for (const t of ['shop', 'check']) { const o = h('option', '', TYPES[t].name); o.value = t; sel.append(o); }
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
// 복사본은 체크를 다 푼 상태로 (여행 짐 → '10월 제주' 같은 새 목록)
function copyNote(n) {
  const c = newRec('note', { type: n.type, title: `${n.title} 복사`, text: n.text || '', order: nextOrder(notes()) });
  const ids = {};
  c.sections = n.sections.map(s => { ids[s.id] = uid(); return { id: ids[s.id], name: s.name }; });
  db.recs.push(c);
  for (const e of entriesOf(n)) {
    db.recs.push(newRec('entry', { note: c.id, section: ids[e.section] || null, text: e.text, done: false, need: !!e.need, order: e.order }));
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
  const mode = editing ? 'edit' : n.type === 'check' ? 'check' : tabOf(n);
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
    out.push(h('p', 'hint', '항목을 적고 Enter. ‘편집 → + 묶음’으로 세안·옷처럼 나눌 수 있어요.'));
  }
  return out;
}

function section(n, s, list, mode) {
  const sid = s ? s.id : null, foldKey = sid || `none:${n.id}`;
  const folded = mode !== 'edit' && !!(prefs.fold || {})[foldKey];
  const box = h('div', 'sec' + (folded ? ' folded' : ''));
  box.dataset.sec = sid || '';
  if (s || n.sections.length) {
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
          const f = { ...prefs.fold };
          if (folded) delete f[foldKey]; else f[foldKey] = true;
          prefs.fold = f;
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
  // 전체(장보기) = 눌러서 살 것 표시, 그 밖 = 눌러서 체크
  const shopAll = mode === 'all';
  li.classList.toggle(shopAll ? 'need' : 'done', !!(shopAll ? e.need : e.done));
  li.append(h('span', shopAll ? 'mark' : 'check'), h('span', 'text', e.text));
  li.title = shopAll ? (e.need ? '눌러서 살 것에서 빼기' : '눌러서 살 것으로 표시') : '';
  li.addEventListener('click', () => {
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
const syncTypePick = () => document.querySelectorAll('#typePick [data-type]').forEach(b => b.classList.toggle('on', b.dataset.type === newType));
$('typePick').addEventListener('click', e => {
  const b = e.target.closest('[data-type]');
  if (b) { newType = b.dataset.type; syncTypePick(); }
});
$('addNoteBtn').addEventListener('click', () => {
  newType = notes().some(n => n.type === 'shop') ? 'check' : 'shop';
  $('newNoteForm').reset();
  syncTypePick();
  $('newNote').showModal();
});
$('newNoteCancel').addEventListener('click', () => $('newNote').close());
$('newNoteForm').addEventListener('submit', e => {
  e.preventDefault();
  const n = newRec('note', { type: newType, title: e.target.title.value.trim(), sections: [], text: '', order: nextOrder(notes()) });
  db.recs.push(n);
  prefs.note = n.id;
  if (n.type === 'shop') prefs.tab = { ...prefs.tab, [n.id]: 'all' }; // 처음엔 늘 사는 것 목록부터
  savePrefs();
  editing = false;
  notePage = true;
  $('newNote').close();
  if (n.type !== 'memo') focusNext = `add:${n.id}:`;
  save();
});
