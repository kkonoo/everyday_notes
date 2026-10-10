'use strict';
// 결산 계산 (화면 없음, 데이터를 읽기만 함): recap.js 가 쓰고, tests/recap.test.js 가 Node에서 확인
// 식단·가계부만. 기간 = 그 해 1/1 ~ 12/31, 올해는 오늘까지 (앞으로 넣어 둔 식단은 안 셈). 지운 것(deleted)은 안 셈
// 카드는 데이터가 있을 때만 만듦 — 없는 숫자를 짐작하지 않음

const recapKey = s => s.toLowerCase().replace(/\s+/g, ''); // app.js 의 norm과 같음 (띄어쓰기·대소문자 무시)
const RECAP_GROUPS = [{ id: 'fixed', name: '고정비' }, { id: 'living', name: '생활비' }, { id: 'allow', name: '용돈' }]; // budget.js 의 기본 지출 분류와 같음

// 가계부 '실제' 금액 = budget.js 와 같은 규칙: 그 달에 적은 금액, '매달 같은 금액'(fixed)은 안 적어도 이번 달(now)까지 계획 금액
// 그 달에 없는 항목(from ≤ 달 < to 밖)이나 안 적은 달은 null (0으로 치지 않음)
function recapActual(l, m, now) {
  if (!(l.from <= m && (!l.to || m < l.to))) return null;
  const a = l.actual && l.actual[m];
  if (a != null) return a;
  if (!l.fixed || m > now) return null;
  let k = null;
  for (const x in l.plans || {}) if (x <= m && (!k || x > k)) k = x;
  return k ? l.plans[k] : 0;
}

// 결산을 볼 수 있는 해: 가장 이른 식단·지출 항목의 해 ~ 올해 (최근 해부터)
function recapYears(recs, today) {
  const now = +today.slice(0, 4);
  let first = now;
  for (const r of recs) {
    if (r.deleted) continue;
    if (r.kind === 'meal' && r.date <= today) first = Math.min(first, +r.date.slice(0, 4));
    if (r.kind === 'bline' && r.side === 'out' && r.from) first = Math.min(first, +r.from.slice(0, 4));
  }
  return Array.from({ length: now - first + 1 }, (_, i) => now - i);
}

// 배너를 띄우는 때: 12/1 ~ 1/31. 볼 해 (1월이면 작년), 아니면 null
function recapSeason(today) {
  const y = +today.slice(0, 4), m = +today.slice(5, 7);
  return m === 12 ? y : m === 1 ? y - 1 : null;
}

// 그 해 카드들. 작년 비교는 작년 같은 기간(올해는 1/1 ~ 오늘 날짜, 가계부는 같은 달까지)
function recapCards(recs, year, today) {
  const live = recs.filter(r => !r.deleted), now = today.slice(0, 7), cards = [];
  if (year > +today.slice(0, 4)) return { year, end: null, cards }; // 아직 안 온 해
  const end = year === +today.slice(0, 4) ? today : `${year}-12-31`;
  const lastEnd = `${year - 1}${end.slice(4)}`;

  // ---------- 식단: 끼니 = 날짜·끼니(아침·점심…) 짝, 메뉴 이름은 연결된 메뉴 이름 (meals.js 의 mealName과 같음) ----------
  const menuName = new Map(live.filter(r => r.kind === 'menu').map(r => [r.id, r.name]));
  const meals = live.filter(r => r.kind === 'meal').map(r => ({ date: r.date, slot: r.slot, name: menuName.get(r.menu) || r.name }));
  const between = (from, to) => meals.filter(m => m.date >= from && m.date <= to);
  const slotCount = list => new Set(list.map(m => `${m.date}|${m.slot}`)).size;
  const mine = between(`${year}-01-01`, end), last = between(`${year - 1}-01-01`, lastEnd);
  if (mine.length) {
    cards.push({ id: 'meals', meals: slotCount(mine), items: mine.length, last: last.length ? slotCount(last) : null });
    const count = new Map(); // 이름 키 → { name: 처음 나온 이름, count }
    for (const m of mine) {
      const k = recapKey(m.name), c = count.get(k) || { name: m.name, count: 0 };
      c.count++;
      count.set(k, c);
    }
    cards.push({ id: 'top', items: [...count.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ko')).slice(0, 5) });
    const lastMonth = +end.slice(5, 7);
    cards.push({ id: 'mealMonths', months: Array.from({ length: lastMonth }, (_, i) => ({
      m: i + 1, n: slotCount(mine.filter(x => +x.date.slice(5, 7) === i + 1)),
    })) });
    // 처음 먹어 본 메뉴 = 그 해 전 식단에 없던 이름. 그 해 전 기록이 있을 때만 (없으면 모두 '처음'이 되니까)
    const before = meals.filter(m => m.date < `${year}-01-01`);
    if (before.length) {
      const old = new Set(before.map(m => recapKey(m.name)));
      const firsts = [...count.entries()].filter(([k]) => !old.has(k)).map(([, c]) => c.name);
      cards.push({ id: 'firsts', count: firsts.length, names: firsts });
    }
  }

  // ---------- 가계부: 지출(out) 항목의 '실제' 금액, 달마다 합계. 적은 금액이 하나도 없는 달은 기록 없음(null) ----------
  const lines = live.filter(r => r.kind === 'bline' && r.side === 'out');
  const conf = live.find(r => r.id === 'budget'), groups = (conf && conf.groups) || RECAP_GROUPS;
  const monthsOf = y => Array.from({ length: +end.slice(5, 7) }, (_, i) => `${y}-${String(i + 1).padStart(2, '0')}`);
  const spend = ms => {
    const byMonth = ms.map(m => lines.reduce((s, l) => { const a = recapActual(l, m, now); return a == null ? s : (s || 0) + a; }, null));
    return { byMonth, total: byMonth.reduce((s, v) => s + (v || 0), 0), recorded: byMonth.filter(v => v != null).length };
  };
  const ms = monthsOf(year), s = spend(ms), ls = spend(monthsOf(year - 1));
  if (s.recorded) {
    cards.push({ id: 'spent', total: s.total, recorded: s.recorded, upTo: ms.length, last: ls.recorded ? ls.total : null });
    if (s.total > 0) {
      const by = new Map(); // 분류 이름 → 금액 (분류가 없거나 지운 분류면 미분류)
      for (const l of lines) {
        const g = groups.find(x => x.id === l.group), name = g ? g.name : '미분류';
        const sum = ms.reduce((t, m) => t + (recapActual(l, m, now) || 0), 0);
        if (sum) by.set(name, (by.get(name) || 0) + sum);
      }
      cards.push({ id: 'groups', items: [...by].map(([name, amount]) => ({ name, amount, share: amount / s.total })).sort((a, b) => b.amount - a.amount) });
      const top = s.byMonth.reduce((best, v, i) => (v != null && v > s.byMonth[best] ? i : best), s.byMonth.findIndex(v => v != null));
      cards.push({ id: 'topMonth', month: top + 1, amount: s.byMonth[top] });
    }
    if (s.recorded >= 2) cards.push({ id: 'spentMonths', months: s.byMonth.map((amount, i) => ({ m: i + 1, amount })) });
  }

  // ---------- 요약: 위 카드에서 나온 숫자만 ----------
  if (cards.length) {
    const get = id => cards.find(c => c.id === id);
    cards.push({
      id: 'summary',
      meals: get('meals') ? get('meals').meals : null,
      topMenu: get('top') ? get('top').items[0].name : null,
      firsts: get('firsts') ? get('firsts').count : null,
      spent: get('spent') ? get('spent').total : null,
      topMonth: get('topMonth') ? get('topMonth').month : null,
    });
  }
  return { year, end, cards };
}

if (typeof module !== 'undefined') module.exports = { recapActual, recapYears, recapSeason, recapCards };
