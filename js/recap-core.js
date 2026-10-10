'use strict';
// 결산 계산 (화면 없음, 데이터를 읽기만 함): recap.js 가 쓰고, tests/recap.test.js 가 Node에서 확인
// 가계부 지출만. 기간 = 그 해 1~12월, 올해는 이번 달까지. 지운 것(deleted)은 안 셈
// 카드는 데이터가 있을 때만 만듦 — 없는 숫자를 짐작하지 않음

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

// 결산을 볼 수 있는 해: 가장 이른 지출 항목의 해 ~ 올해 (최근 해부터)
function recapYears(recs, today) {
  const now = +today.slice(0, 4);
  let first = now;
  for (const r of recs) {
    if (r.deleted) continue;
    if (r.kind === 'bline' && r.side === 'out' && r.from) first = Math.min(first, +r.from.slice(0, 4));
  }
  return Array.from({ length: now - first + 1 }, (_, i) => now - i);
}

// 배너를 띄우는 때: 12/1 ~ 1/31. 볼 해 (1월이면 작년), 아니면 null
function recapSeason(today) {
  const y = +today.slice(0, 4), m = +today.slice(5, 7);
  return m === 12 ? y : m === 1 ? y - 1 : null;
}

// 그 해 카드들. 작년 비교는 작년 같은 기간(올해는 1월 ~ 이번 달)
function recapCards(recs, year, today) {
  const live = recs.filter(r => !r.deleted), now = today.slice(0, 7), cards = [];
  if (year > +today.slice(0, 4)) return { year, end: null, cards }; // 아직 안 온 해
  const end = year === +today.slice(0, 4) ? today : `${year}-12-31`;

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

  return { year, end, cards };
}

if (typeof module !== 'undefined') module.exports = { recapActual, recapYears, recapSeason, recapCards };
