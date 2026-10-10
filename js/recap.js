'use strict';
// 결산 (설정 맨 위 📊 결산, 12/1 ~ 1/31엔 홈 위 배너로도): 식단·가계부 한 해를 탭(식단·가계부·한눈에)마다 카드로 위아래 쭉
// 숫자는 recap-core.js 에서 (데이터를 읽기만 함). 이 화면도 데이터를 고치지 않음 — 금액 숨기기·배너 닫기는 이 기기 설정(prefs.recap)만
// 그래프는 한 계열 = 한 색(--accent), 막대는 얇게·끝만 둥글게, 숫자는 가장 큰 막대에만 (나머지는 마우스를 올리면)
let recapYear = null, recapTab = null; // 보는 해, 탭 (앱을 켜 둔 동안)
const recapPrefs = () => ({ hide: false, closed: null, ...prefs.recap });
function setRecap(patch) {
  prefs.recap = { ...recapPrefs(), ...patch };
  savePrefs();
}
function openRecap(year = +todayStr().slice(0, 4)) {
  recapYear = year;
  recapTab = null;
  openPage('recap');
}
const money = v => (recapPrefs().hide ? '●●●원' : `${won(v)}원`);
// 탭: 카드가 있는 것만. 지금 탭과 그 탭의 카드들
const RECAP_TABS = [['meals', '🍚 식단', ['meals', 'top', 'mealMonths', 'firsts']], ['budget', '💰 가계부', ['spent', 'groups', 'topMonth', 'spentMonths']], ['summary', '📊 한눈에', ['summary']]];
function recapTabs(cards) {
  const tabs = RECAP_TABS.map(([key, label, ids]) => ({ key, label, cards: cards.filter(c => ids.includes(c.id)) })).filter(t => t.cards.length);
  return { tabs, tab: tabs.find(t => t.key === recapTab) || tabs[0] };
}
const moneyShort = v => (recapPrefs().hide ? '●●●' : v >= 10000 ? `${won(v / 10000)}만` : won(v)); // 그래프 숫자

function renderRecap() {
  const today = todayStr(), years = recapYears(db.recs, today), o = recapPrefs();
  if (!years.includes(recapYear)) recapYear = years[0];
  const { cards, end } = recapCards(db.recs, recapYear, today);
  const head = h('div', 'page-head'), back = button('‹', closePage, 'icon-btn'), year = h('select', 'year-select');
  back.title = '돌아가기';
  fillSelect(year, years.map(y => [String(y), `${y}년`]), String(recapYear));
  year.addEventListener('change', () => { recapYear = +year.value; render(); });
  const hide = button(o.hide ? '🙈 금액 숨김' : '👀 금액 보임', () => { setRecap({ hide: !o.hide }); render(); }, 'btn small head-end');
  hide.title = '카드의 금액을 ●●●로 가리기';
  head.append(back, h('h2', '', '📊 결산'), year, hide);
  const partial = end !== `${recapYear}-12-31`, [, em, ed] = ymd(end);
  const title = h('div', 'recap-title');
  title.append(h('b', '', `${recapYear}년 ${partial ? '지금까지 결산' : '결산'}`), h('span', 'hint', `1월 1일 ~ ${em}월 ${ed}일 · 식단·가계부`));
  if (!cards.length) {
    $('recapView').replaceChildren(head, title, h('p', 'panel recap-empty', '이 해에는 식단·가계부 기록이 없어요.'));
    return;
  }
  // 탭 (식단·가계부·한눈에) + 그 탭의 카드들 (위아래로)
  const { tabs, tab } = recapTabs(cards), seg = h('div', 'seg recap-tabs'), list = h('div', 'recap-list');
  recapTab = tab.key;
  seg.append(...tabs.map(t => button(t.key === 'summary' ? t.label : `${t.label} ${t.cards.length}`, () => { recapTab = t.key; render(); }, t === tab ? 'on' : '')));
  list.append(...tab.cards.map(c => recapCard(c, recapYear)));
  $('recapView').replaceChildren(head, title, ...(tabs.length > 1 ? [seg] : []), list);
}

// ---------- 카드 ----------
function recapCard(c, year) {
  const box = h('article', 'recap-card'), add = (...els) => box.append(...els);
  if (c.id === 'meals') {
    add(h('h3', '', '기록한 끼니'), h('div', 'rc-big', `${c.meals}끼`), h('p', 'rc-sub', `메뉴 ${c.items}개를 기록했어요`));
    if (c.last != null) {
      const d = c.meals - c.last;
      add(h('p', 'rc-vs', d ? `작년 같은 기간(${c.last}끼)보다 ${Math.abs(d)}끼 ${d > 0 ? '더' : '덜'} 기록했어요` : `작년 같은 기간과 같아요 (${c.last}끼)`));
    }
  } else if (c.id === 'top') {
    const max = c.items[0].count;
    add(h('h3', '', '가장 많이 먹은 메뉴'), h('div', 'rc-big name', c.items[0].name),
      recapBars(c.items.map((x, i) => ({ label: `${i + 1}. ${x.name}`, share: x.count / max, value: `${x.count}번` }))));
  } else if (c.id === 'mealMonths') {
    const best = c.months.reduce((a, x) => (x.n > a.n ? x : a));
    add(h('h3', '', '달마다 기록한 끼니'),
      recapColumns(c.months.map(x => ({ label: x.m, value: x.n, tip: `${x.m}월 ${x.n}끼` })), v => `${v}끼`),
      h('p', 'rc-sub', `가장 많이 기록한 달은 ${best.m}월 (${best.n}끼)`));
  } else if (c.id === 'firsts') {
    const chips = h('div', 'pills rc-names'), shown = c.names.slice(0, 12);
    chips.append(...shown.map(x => h('span', '', x)), ...(c.names.length > shown.length ? [h('span', 'more', `외 ${c.names.length - shown.length}개`)] : []));
    add(h('h3', '', '처음 먹어 본 메뉴'), h('div', 'rc-big', `${c.count}개`), h('p', 'rc-sub', `${year - 1}년까지 식단에 없던 메뉴예요`), chips);
  } else if (c.id === 'spent') {
    add(h('h3', '', '총지출'), h('div', 'rc-big', money(c.total)),
      h('p', 'rc-sub', `${c.recorded}달 기록 · 가계부 ‘실제’ 금액` + (c.recorded < c.upTo ? ` (안 적은 ${c.upTo - c.recorded}달은 빼고)` : '')));
    if (c.last != null) {
      const d = c.total - c.last, when = c.upTo === 12 ? '작년' : `작년 1–${c.upTo}월`;
      const pct = c.last > 0 && d ? ` (${d > 0 ? '+' : '−'}${Math.round(Math.abs(d) / c.last * 100)}%)` : '';
      add(h('p', 'rc-vs', d ? `${when}(${money(c.last)})보다 ${money(Math.abs(d))} ${d > 0 ? '더' : '덜'} 썼어요${pct}` : `${when}과 같아요 (${money(c.last)})`));
    }
  } else if (c.id === 'groups') {
    add(h('h3', '', '어디에 썼나'), h('div', 'rc-big name', c.items[0].name), h('p', 'rc-sub', '지출 분류별 비중'),
      recapBars(c.items.map(x => ({ label: x.name, share: x.share, value: `${Math.round(x.share * 100)}%`, sub: money(x.amount) }))));
  } else if (c.id === 'topMonth') {
    add(h('h3', '', '가장 많이 쓴 달'), h('div', 'rc-big', `${c.month}월`), h('p', 'rc-sub', money(c.amount)));
  } else if (c.id === 'spentMonths') {
    add(h('h3', '', '달마다 쓴 돈'),
      recapColumns(c.months.map(x => ({ label: x.m, value: x.amount, tip: x.amount == null ? `${x.m}월 기록 없음` : `${x.m}월 ${money(x.amount)}` })), moneyShort),
      ...(c.months.some(x => x.amount == null) ? [h('p', 'rc-sub', '–는 지출을 안 적은 달이에요')] : []));
  } else if (c.id === 'summary') {
    const ul = h('ul', 'rc-summary');
    const line = (icon, text) => { const li = h('li'); li.append(h('span', 'icon', icon), h('span', '', text)); ul.append(li); };
    if (c.meals != null) line('🍚', `${c.meals}끼를 기록했어요`);
    if (c.topMenu) line('🥇', `가장 많이 먹은 메뉴는 ‘${c.topMenu}’`);
    if (c.firsts != null) line('✨', `처음 먹어 본 메뉴 ${c.firsts}개`);
    if (c.spent != null) line('💰', `총지출 ${money(c.spent)}`);
    if (c.topMonth) line('📅', `가장 많이 쓴 달은 ${c.topMonth}월`);
    add(h('h3', '', `${year}년 한눈에`), ul);
  }
  return box;
}
// 가로 막대 (한 계열): 이름 | 막대(가장 큰 것 = 꽉) | 값
function recapBars(rows) {
  const box = h('div', 'rc-bars');
  for (const r of rows) {
    const track = h('span', 'track'), bar = h('i'), val = h('span', 'val', r.value);
    bar.style.width = `${Math.max(2, r.share * 100)}%`;
    track.append(bar);
    if (r.sub) val.append(h('small', '', r.sub));
    box.append(h('span', 'name', r.label), track, val);
  }
  return box;
}
// 세로 막대 (한 계열, 달마다): 값이 null이면 기록 없음(막대 없이 –). 숫자는 가장 큰 막대 위에만, 나머지는 마우스를 올리면
function recapColumns(items, fmt) {
  const max = Math.max(0, ...items.map(x => x.value || 0)), box = h('div', 'rc-cols');
  let labeled = false;
  for (const x of items) {
    const col = h('div', 'rc-col' + (x.value == null ? ' none' : '')), area = h('div', 'area'), bar = h('i'), pct = max ? (x.value || 0) / max * 100 : 0;
    col.title = x.tip;
    bar.style.height = `${pct}%`;
    area.append(x.value == null ? h('span', 'rc-none', '–') : bar);
    if (!labeled && max && x.value === max) {
      const v = h('span', 'rc-val', fmt(x.value));
      v.style.bottom = `calc(${pct}% + 4px)`;
      area.append(v);
      labeled = true;
    }
    col.append(area, h('span', 'rc-lab', x.label));
    box.append(col);
  }
  return box;
}

// ---------- 12/1 ~ 1/31: 메인 화면 위 '결산 보러 가기' 배너 (닫으면 그 시즌엔 이 기기에서 다시 안 뜸) ----------
function renderRecapBanner() {
  const today = todayStr(), year = recapSeason(today), b = $('recapBanner');
  b.hidden = page || year == null || recapPrefs().closed === year || !recapCards(db.recs, year, today).cards.length;
  if (b.hidden) return;
  const go = button(`📊 ${year === +today.slice(0, 4) ? '올해' : `${year}년`} 결산 보러 가기`, () => openRecap(year), 'banner-go');
  const x = iconBtn('✕', '닫기 (이번 시즌엔 다시 안 떠요)', () => { setRecap({ closed: year }); render(); });
  b.replaceChildren(go, x);
}

$('recapBtn').addEventListener('click', () => { $('settings').close(); openRecap(); });
