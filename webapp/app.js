'use strict';

/* ───────── Telegram ───────── */
const tg = window.Telegram && window.Telegram.WebApp;
const BG = '#2c2c2e';
if (tg) {
  tg.ready();
  tg.expand();
  try { tg.setHeaderColor(BG); tg.setBackgroundColor(BG); tg.setBottomBarColor && tg.setBottomBarColor(BG); } catch (e) {}
  try { tg.disableVerticalSwipes && tg.disableVerticalSwipes(); } catch (e) {}
}
const haptic = (t = 'light') => { try { tg.HapticFeedback.impactOccurred(t); } catch (e) {} };
const hapticOk = () => { try { tg.HapticFeedback.notificationOccurred('success'); } catch (e) {} };

/* ───────── состояние ───────── */
const S = {
  tab: 'today', day: null, today: null,
  state: null, month: null, ym: null, notes: null,
  open: {},     // раскрытые группы на экране «Сегодня»
  mclosed: {},  // свёрнутые группы в таблице месяца
  draft: null,  // черновик привычки в редакторе
  locked: false,
  ib: null, food: null, wk: null, settings: null,
  wkPick: null, pick: null, tb: null,
};
const SUBTABS = { month: 'more', notes: 'more', habits: 'more', profile: 'more' };

/* ───────── помощники ───────── */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const pad = n => String(n).padStart(2, '0');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const WD_FULL = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];

const parseD = d => { const [y, m, dd] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd)); };
const fmtD = dt => dt.toISOString().slice(0, 10);
const addDays = (d, n) => { const x = parseD(d); x.setUTCDate(x.getUTCDate() + n); return fmtD(x); };
const wdOf = d => (parseD(d).getUTCDay() + 6) % 7;
const daysBetween = (a, b) => Math.round((parseD(b) - parseD(a)) / 86400000);
const humanDay = d => { const x = parseD(d); return `${x.getUTCDate()} ${MONTHS_GEN[x.getUTCMonth()]}, ${WD_FULL[wdOf(d)]}`; };
const plural = (n, a, b, c) => { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? a : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? b : c; };
const shiftYm = (ym, n) => { let [y, m] = ym.split('-').map(Number); m += n; while (m < 1) { m += 12; y--; } while (m > 12) { m -= 12; y++; } return `${y}-${pad(m)}`; };

const ICON = {
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  left: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  right: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="M6 15l6-6 6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  bell: '<svg viewBox="0 0 24 24"><path d="M6 9a6 6 0 1 1 12 0c0 6.5 2.5 8 2.5 8h-17S6 15.5 6 9"/><path d="M10.3 20.5a2 2 0 0 0 3.4 0"/></svg>',
  cal: '<svg viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="17" height="16" rx="3"/><path d="M3.5 9.5h17M8 2.8v3.4M16 2.8v3.4"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
};

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}

function confirmBox(msg) {
  return new Promise(res => {
    if (tg && tg.initData && tg.showConfirm) {
      try { tg.showConfirm(msg, ok => res(!!ok)); return; } catch (e) {}
    }
    res(window.confirm(msg));
  });
}

/* ───────── API ───────── */
async function api(path, body) {
  const opt = { headers: { 'X-Init-Data': (tg && tg.initData) || '' } };
  if (body !== undefined) {
    opt.method = 'POST';
    opt.headers['Content-Type'] = 'application/json';
    opt.body = JSON.stringify(body);
  }
  let r;
  try { r = await fetch(path, opt); } catch (e) { toast('Нет соединения с сервером'); throw e; }
  let data = {};
  try { data = await r.json(); } catch (e) {}
  if (r.status === 401 || r.status === 403) { S.locked = data.error || 'Нет доступа'; render(); throw new Error(S.locked); }
  if (!r.ok) { const m = data.error || `Ошибка ${r.status}`; toast(m); throw new Error(m); }
  return data;
}

async function loadState(day) {
  const st = await api('/api/state' + (day ? `?day=${day}` : ''));
  S.state = st; S.day = st.date; S.today = st.today;
}
async function loadMonth(ym) {
  S.month = await api('/api/month' + (ym ? `?ym=${ym}` : ''));
  S.ym = S.month.ym; S.today = S.month.today;
}
async function loadNotes() { S.notes = (await api('/api/notes')).notes; }

async function reload() {
  try {
    if (S.tab === 'month') await loadMonth(S.ym);
    else if (S.tab === 'notes') await loadNotes();
    else if (S.tab === 'ibadah') await loadIb();
    else if (S.tab === 'food') await loadFood();
    else if (S.tab === 'sport') await loadWk();
    else if (S.tab === 'profile') S.settings = await api('/api/settings');
    else if (S.tab === 'more') { /* меню */ }
    else await loadState(S.day);
  } catch (e) { /* сообщение уже показано */ }
  render();
}

/* ───────── отрисовка ───────── */
const loader = () => '<div class="loader">Загрузка…</div>';

function render() {
  const group = SUBTABS[S.tab] || S.tab;
  $$('#tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === group));
  const v = $('#view');
  if (S.locked) {
    v.innerHTML = `<div class="locked"><b>Нет доступа</b>${esc(S.locked)}</div>`;
    return;
  }
  const views = { month: viewMonth, notes: viewNotes, habits: viewHabits, ibadah: viewIbadah, food: viewFood,
    sport: viewSport, more: viewMore, profile: viewProfile };
  v.innerHTML = (SUBTABS[S.tab] ? '<button class="backlink" data-act="tab" data-tab="more">' + ICON.left + 'Ещё</button>' : '')
    + (views[S.tab] || viewToday)();
  if (S.tab === 'month') scrollMonthToToday();
}

function findHabit(id) {
  for (const h of (S.state ? S.state.habits : [])) {
    if (h.id === id) return h;
    for (const c of h.children) if (c.id === id) return c;
  }
  return null;
}

function progress(st, done) {
  let n = 0, total = 0;
  for (const h of st.habits) {
    if (h.kind === 'weekly') continue;
    const items = h.kind === 'group' ? h.children : [h];
    for (const x of items) { total++; if (done.has(x.id)) n++; }
  }
  return [n, total];
}

function remindMeta(time) { return time ? `<span>·</span>${ICON.bell}<span>${time}</span>` : ''; }

/* «Сегодня» */
function viewToday() {
  const st = S.state;
  if (!st) return loader();
  const done = new Set(st.done);
  const d = st.date, isToday = d === st.today, future = d > st.today;
  const label = isToday ? 'Сегодня' : d === addDays(st.today, -1) ? 'Вчера' : d === addDays(st.today, 1) ? 'Завтра'
    : WD_FULL[wdOf(d)][0].toUpperCase() + WD_FULL[wdOf(d)].slice(1);
  const [n, total] = progress(st, done);

  const habitRows = st.habits.map(h => {
    if (h.kind === 'group') {
      const k = h.children.filter(c => done.has(c.id)).length, tot = h.children.length;
      const full = tot > 0 && k === tot;
      return `<div class="group ${S.open[h.id] ? 'open' : ''}">
        <div class="row" data-act="expand" data-id="${h.id}">
          <span class="ring ${full ? 'full' : ''}" style="--p:${tot ? k / tot : 0}">${full ? ICON.check : ''}</span>
          <div class="rmain"><div class="rtitle">${esc(h.name)}</div>
            <div class="rmeta"><span>${k} из ${tot}</span>${remindMeta(h.remind_time)}</div></div>
          <span class="chev">${ICON.right}</span>
        </div>
        <div class="kids">${h.children.map(c => `
          <div class="row ${future ? 'disabled' : ''}" data-act="toggle" data-id="${c.id}">
            <span class="check ${done.has(c.id) ? 'on' : ''}">${ICON.check}</span>
            <div class="rmain"><div class="rtitle">${esc(c.name)}</div></div>
          </div>`).join('')}</div>
      </div>`;
    }
    let meta = '';
    if (h.kind === 'weekly') {
      const w = (st.week[h.id] || 0);
      meta = w >= h.target ? `<span class="goal">${w} из ${h.target} · цель недели выполнена</span>` : `<span>${w} из ${h.target} на этой неделе</span>`;
    } else meta = '<span>каждый день</span>';
    return `<div class="row ${future ? 'disabled' : ''}" data-act="toggle" data-id="${h.id}">
      <span class="check ${done.has(h.id) ? 'on' : ''}">${ICON.check}</span>
      <div class="rmain"><div class="rtitle">${esc(h.name)}</div><div class="rmeta">${meta}${remindMeta(h.remind_time)}</div></div>
    </div>`;
  }).join('');

  const taskRows = st.tasks.map(t => `
    <div class="row task ${t.done ? 'done' : ''}">
      <button class="check ${t.done ? 'on' : ''}" data-act="ttoggle" data-id="${t.id}">${ICON.check}</button>
      <div class="rmain" data-act="tedit" data-id="${t.id}"><div class="rtitle">${esc(t.title)}</div>
        ${t.remind_time ? `<div class="rmeta">${ICON.bell}<span>${t.remind_time}</span></div>` : ''}</div>
    </div>`).join('');

  const tasksLeft = st.tasks.filter(t => !t.done).length;

  return `
    <div class="dayhead">
      <button class="iconbtn" data-act="day" data-n="-1" aria-label="Предыдущий день">${ICON.left}</button>
      <div class="daytitle"><div class="big">${label}</div><div class="sub">${humanDay(d)}</div></div>
      <button class="iconbtn" data-act="day" data-n="1" aria-label="Следующий день">${ICON.right}</button>
    </div>
    ${isToday ? '' : '<button class="linkbtn" data-act="gotoday">Вернуться к сегодня</button>'}
    ${total ? `<div class="progress"><div class="bar"><i style="width:${Math.round(n / total * 100)}%"></i></div><span>${n} из ${total}</span></div>` : ''}

    <div class="sec-h"><span>Привычки</span></div>
    <div class="card ckl">${habitRows || '<div class="empty">Добавь привычки во вкладке «Привычки»</div>'}</div>

    <div class="sec-h"><span>Задачи</span>${st.tasks.length ? `<small>${tasksLeft ? `осталось ${tasksLeft}` : 'всё сделано'}</small>` : ''}</div>
    ${isToday && st.overdue ? `<div class="banner"><span>${st.overdue} ${plural(st.overdue, 'невыполненная задача', 'невыполненные задачи', 'невыполненных задач')} с прошлых дней</span><button data-act="carry">Перенести</button></div>` : ''}
    <div class="card ckl">
      ${taskRows}
      <div class="row addrow" data-act="tnew">${ICON.plus}<span>Новая задача</span></div>
    </div>`;
}

/* «Месяц» */
function viewMonth() {
  const M = S.month;
  if (!M) return loader();
  const [y, m] = M.ym.split('-').map(Number);
  const n = M.days, today = M.today, curYm = today.slice(0, 7);
  const ds = d => `${M.ym}-${pad(d)}`;
  const days = Array.from({ length: n }, (_, i) => i + 1);
  const logs = id => new Set(M.logs[id] || []);
  const startOf = h => { const f = M.first_log[h.id]; return f && f < h.created ? f : h.created; };
  const groupStart = g => g.children.reduce((a, c) => (startOf(c) < a ? startOf(c) : a), startOf(g));

  // засчитывается ли день в статистику: прошедший день после начала, или сегодня, если уже выполнено
  const counts = (date, start, isDone) => date >= start && (date < today || (date === today && isDone));

  let sumDone = 0, sumAll = 0;
  const dailyItems = [];  // все ежедневные пункты для «идеальных дней»

  function cellSimple(h, d, L, start) {
    const date = ds(d), tc = date === today ? ' tc' : '';
    if (date > today) return `<td class="${tc}"></td>`;
    if (L.has(d)) return `<td class="ok${tc}">✓</td>`;
    if (date < start) return `<td class="${tc}"></td>`;
    if (h.kind === 'weekly' || date === today) return `<td class="dot${tc}">·</td>`;
    return `<td class="no${tc}">✕</td>`;
  }

  function rowSimple(h, cls) {
    const L = logs(h.id), start = startOf(h);
    let done = 0, elig = 0;
    for (const d of days) { if (counts(ds(d), start, L.has(d))) { elig++; if (L.has(d)) done++; } else if (L.has(d)) done++; }
    let sum;
    if (h.kind === 'weekly') {
      const goal = Math.max(1, Math.round(h.target * elig / 7));
      sum = `${done}/${goal}`;
    } else {
      sum = elig ? `${done}/${elig}` : '—';
      sumDone += Math.min(done, elig); sumAll += elig;
      dailyItems.push({ L, start });
    }
    return `<tr class="${cls}"><td class="name">${esc(h.name)}</td>${days.map(d => cellSimple(h, d, L, start)).join('')}<td class="sum">${sum}</td></tr>`;
  }

  const rows = M.habits.map(h => {
    if (h.kind !== 'group') return rowSimple(h, '');
    const open = !S.mclosed[h.id];
    const Ls = h.children.map(c => logs(c.id)), tot = h.children.length, gs = groupStart(h);
    let full = 0, elig = 0;
    const cells = days.map(d => {
      const date = ds(d), tc = date === today ? ' tc' : '';
      const k = Ls.filter(L => L.has(d)).length, isFull = tot > 0 && k === tot;
      if (counts(date, gs, isFull)) { elig++; if (isFull) full++; }
      if (date > today) return `<td class="${tc}"></td>`;
      if (isFull) return `<td class="ok${tc}">✓</td>`;
      if (k > 0) return `<td class="part${tc}">${k}</td>`;
      if (date < gs) return `<td class="${tc}"></td>`;
      if (date === today) return `<td class="dot${tc}">·</td>`;
      return `<td class="no${tc}">✕</td>`;
    }).join('');
    const kids = h.children.map(c => rowSimple(c, 'sub')).join('');
    return `<tr class="grp ${open ? 'open' : ''}"><td class="name" data-act="mtoggle" data-id="${h.id}">${ICON.right}${esc(h.name)}</td>${cells}<td class="sum">${elig ? `${full}/${elig}` : '—'}</td></tr>${open ? kids : ''}`;
  }).join('');

  // если группа свёрнута, её пункты всё равно учитываем в статистике
  M.habits.filter(h => h.kind === 'group' && S.mclosed[h.id]).forEach(h => h.children.forEach(c => rowSimple(c, 'sub')));

  let perfect = 0;
  for (const d of days) {
    const date = ds(d);
    if (date > today) break;
    const act = dailyItems.filter(x => date >= x.start);
    if (!act.length) continue;
    if (act.every(x => x.L.has(d))) perfect++;
  }
  const pct = sumAll ? Math.round(sumDone / sumAll * 100) : 0;

  const head = days.map(d => {
    const w = wdOf(ds(d)), tc = ds(d) === today ? ' tc' : '';
    return `<th class="${w >= 5 ? 'we' : ''}${tc}">${WD[w]}<b>${d}</b></th>`;
  }).join('');

  return `
    <div class="monthhead">
      <button class="iconbtn" data-act="month" data-n="-1" aria-label="Предыдущий месяц">${ICON.left}</button>
      <div class="daytitle"><div class="big">${MONTHS[m - 1]}</div><div class="sub">${y}</div></div>
      <button class="iconbtn" data-act="month" data-n="1" ${M.ym >= curYm ? 'disabled' : ''} aria-label="Следующий месяц">${ICON.right}</button>
    </div>
    <div class="stats">
      <div class="stat"><b>${pct}%</b><span>выполнено за месяц</span></div>
      <div class="stat"><b>${perfect}</b><span>${plural(perfect, 'идеальный день', 'идеальных дня', 'идеальных дней')}</span></div>
    </div>
    ${M.habits.length ? `<div class="mwrap" id="mwrap"><table class="m" style="width:${124 + n * 30 + 56}px">
      <thead><tr><th class="name"></th>${head}<th class="sum">Итог</th></tr></thead>
      <tbody>${rows}</tbody></table></div>` : '<div class="card"><div class="empty">Пока нет привычек</div></div>'}
    <div class="legend"><span><b class="ok">✓</b>выполнено</span><span><b class="no">✕</b>пропущено</span><span><b class="part">3</b>сколько пунктов группы</span><span><b>·</b>ещё можно</span></div>
    <p class="hint">Процент и идеальные дни считаются по ежедневным привычкам. Для привычек «N раз в неделю» в итоге показано: сделано / цель за месяц.</p>`;
}

function scrollMonthToToday() {
  const w = $('#mwrap'), t = w && w.querySelector('thead th.tc');
  if (w && t) w.scrollLeft = Math.max(0, t.offsetLeft - w.clientWidth + 120);
}

/* «Заметки» */
function fmtStamp(s) {
  if (!s) return '';
  const [d, t] = s.split('T');
  const x = parseD(d);
  const sameYear = d.slice(0, 4) === (S.today || d).slice(0, 4);
  return `${x.getUTCDate()} ${MONTHS_GEN[x.getUTCMonth()]}${sameYear ? '' : ' ' + d.slice(0, 4)}, ${t}`;
}

function viewNotes() {
  const list = S.notes;
  return `
    <h1 class="title">Заметки</h1>
    <div class="card compose">
      <textarea id="n-new" rows="2" placeholder="Новая заметка…"></textarea>
      <button class="btn primary" data-act="nadd">Сохранить</button>
    </div>
    ${!list ? loader() : list.length ? list.map(nt => `
      <div class="note" data-act="nedit" data-id="${nt.id}">
        <div class="ntext">${esc(nt.text)}</div>
        <div class="ndate">${fmtStamp(nt.updated)}</div>
      </div>`).join('') : '<div class="empty">Заметок пока нет</div>'}`;
}

/* «Привычки» — управление */
function kindLabel(h) {
  if (h.kind === 'weekly') return `${h.target} ${plural(h.target, 'раз', 'раза', 'раз')} в неделю`;
  if (h.kind === 'group') return `группа · ${h.children.length} ${plural(h.children.length, 'пункт', 'пункта', 'пунктов')}`;
  return 'каждый день';
}

function viewHabits() {
  const hs = S.state ? S.state.habits : null;
  if (!hs) return loader();
  return `
    <h1 class="title">Привычки</h1>
    <div class="card">${hs.map((h, i) => `
      <div class="row" data-act="hedit" data-id="${h.id}">
        <div class="rmain"><div class="rtitle">${esc(h.name)}</div><div class="rmeta"><span>${kindLabel(h)}</span>${remindMeta(h.remind_time)}</div></div>
        <div class="order">
          <button class="mini" data-act="hmove" data-id="${h.id}" data-n="-1" ${i === 0 ? 'disabled' : ''} aria-label="Выше">${ICON.up}</button>
          <button class="mini" data-act="hmove" data-id="${h.id}" data-n="1" ${i === hs.length - 1 ? 'disabled' : ''} aria-label="Ниже">${ICON.down}</button>
        </div>
      </div>`).join('') || '<div class="empty">Привычек пока нет</div>'}
    </div>
    <button class="btn primary" data-act="hnew">${ICON.plus}Добавить привычку</button>
    <p class="hint">Группа — привычка с несколькими пунктами внутри, например «Намаз» с пятью молитвами. Каждый пункт отмечается отдельно.</p>`;
}

/* ───────── нижний лист ───────── */
function openSheet(html, onMount) {
  const sh = $('#sheet');
  sh.innerHTML = `<div class="sheet-bg" data-act="close"></div><div class="sheet-body"><div class="grab"></div>${html}</div>`;
  requestAnimationFrame(() => sh.classList.add('show'));
  try { tg.BackButton.show(); } catch (e) {}
  onMount && onMount(sh);
}
function closeSheet() {
  $('#sheet').classList.remove('show');
  try { tg.BackButton.hide(); } catch (e) {}
  document.activeElement && document.activeElement.blur && document.activeElement.blur();
}
try { tg.BackButton.onClick(closeSheet); } catch (e) {}

function bindSwitch(sw, row) {
  const upd = () => { row.hidden = !sw.checked; };
  sw.addEventListener('change', upd);
  upd();
}

function nextHour() { const d = new Date(); d.setHours(d.getHours() + 1, 0, 0, 0); return `${pad(d.getHours())}:00`; }

function taskSheet(t) {
  openSheet(`
    <h3>${t ? 'Задача' : 'Новая задача'}</h3>
    <input id="t-title" class="field" placeholder="Что нужно сделать?" maxlength="300" value="${t ? esc(t.title) : ''}" enterkeyhint="done">
    <div class="field-row"><span>${ICON.cal}Дата</span><input type="date" id="t-day" value="${t ? t.day : S.day}"></div>
    <div class="field-row"><span>${ICON.bell}Напоминание</span><label class="switch"><input type="checkbox" id="t-rem" ${t && t.remind_time ? 'checked' : ''}><i></i></label></div>
    <div class="field-row" id="t-time-row"><span>${ICON.clock}Время</span><input type="time" id="t-time" value="${(t && t.remind_time) || nextHour()}"></div>
    <button class="btn primary" data-act="tsave" data-id="${t ? t.id : ''}">Сохранить</button>
    ${t ? `<div class="btn-row">
      <button class="btn" data-act="ttomorrow" data-id="${t.id}">На завтра</button>
      <button class="btn danger" data-act="tdel" data-id="${t.id}">Удалить</button></div>` : ''}`,
    sh => {
      bindSwitch($('#t-rem'), $('#t-time-row'));
      const inp = $('#t-title');
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); ACT.tsave(sh.querySelector('[data-act=tsave]')); } });
      if (!t) setTimeout(() => inp.focus(), 320);
    });
}

const kidRow = c => `<div class="kid"><input class="field" maxlength="100" placeholder="Название пункта" value="${esc(c.name || '')}" data-kid="${c.id || ''}"><button class="x" data-act="hkiddel" aria-label="Убрать">×</button></div>`;

function habitSheet(h) {
  S.draft = { kind: h ? h.kind : 'daily', target: h && h.kind === 'weekly' ? h.target : 3 };
  const kids = h && h.kind === 'group' ? h.children : [{}, {}];
  openSheet(`
    <h3>${h ? 'Привычка' : 'Новая привычка'}</h3>
    <input id="h-name" class="field" maxlength="100" placeholder="Например: Прочитать 20 страниц" value="${h ? esc(h.name) : ''}">
    <div class="seg" id="h-seg">
      <button data-act="hkind" data-k="daily">Каждый день</button>
      <button data-act="hkind" data-k="weekly">N раз в неделю</button>
      <button data-act="hkind" data-k="group">Группа</button>
    </div>
    <div class="field-row" id="h-weekly"><span>Раз в неделю</span>
      <div class="stepper"><button data-act="hstep" data-n="-1">−</button><b id="h-target">${S.draft.target}</b><button data-act="hstep" data-n="1">+</button></div></div>
    <div id="h-group">
      <div class="sublabel">Пункты внутри группы</div>
      <div id="h-kids">${kids.map(kidRow).join('')}</div>
      <button class="btn ghost" data-act="hkidadd">${ICON.plus}Добавить пункт</button>
    </div>
    <div class="field-row"><span>${ICON.bell}Напоминание</span><label class="switch"><input type="checkbox" id="h-rem" ${h && h.remind_time ? 'checked' : ''}><i></i></label></div>
    <div class="field-row" id="h-time-row"><span>${ICON.clock}Время</span><input type="time" id="h-time" value="${(h && h.remind_time) || '21:00'}"></div>
    <p class="hint" id="h-rem-hint">Бот напомнит в это время, если привычка ещё не отмечена.</p>
    <button class="btn primary" data-act="hsave" data-id="${h ? h.id : ''}">Сохранить</button>
    ${h ? `<button class="btn danger" data-act="hdel" data-id="${h.id}">Удалить привычку</button>` : ''}`,
    () => {
      syncHabitSheet();
      const sw = $('#h-rem');
      bindSwitch(sw, $('#h-time-row'));
      const hint = () => { $('#h-rem-hint').hidden = !sw.checked; };
      sw.addEventListener('change', hint); hint();
      if (!h) setTimeout(() => $('#h-name').focus(), 320);
    });
}

function syncHabitSheet() {
  $$('#h-seg button').forEach(b => b.classList.toggle('on', b.dataset.k === S.draft.kind));
  $('#h-weekly').hidden = S.draft.kind !== 'weekly';
  $('#h-group').hidden = S.draft.kind !== 'group';
  $('#h-target').textContent = S.draft.target;
}

function noteSheet(nt) {
  openSheet(`
    <h3>Заметка</h3>
    <textarea id="n-text" class="field">${esc(nt.text)}</textarea>
    <button class="btn primary" data-act="nsave" data-id="${nt.id}">Сохранить</button>
    <button class="btn danger" data-act="ndel" data-id="${nt.id}">Удалить</button>`);
}

/* ───────── действия ───────── */
const ACT = {
  tab(el) {
    if (S.tab === el.dataset.tab) return;
    S.tab = el.dataset.tab;
    window.scrollTo(0, 0);
    render();
    reload();
  },
  close: closeSheet,

  async day(el) {
    S.day = addDays(S.day || S.today, +el.dataset.n);
    haptic('light');
    await reload();
  },
  async gotoday() { S.day = null; await reload(); },
  expand(el) { S.open[el.dataset.id] = !S.open[el.dataset.id]; haptic('light'); render(); },

  async toggle(el) {
    const st = S.state, id = +el.dataset.id;
    if (st.date > st.today) { toast('Будущий день нельзя отметить'); return; }
    const done = new Set(st.done), on = !done.has(id);
    on ? done.add(id) : done.delete(id);
    st.done = [...done];
    const h = findHabit(id);
    if (h && h.kind === 'weekly') st.week[id] = Math.max(0, (st.week[id] || 0) + (on ? 1 : -1));
    haptic(on ? 'medium' : 'light');
    const [n, total] = progress(st, done);
    if (on && total && n === total) hapticOk();
    render();
    try { await api('/api/habits/toggle', { id, day: st.date }); } catch (e) { await reload(); }
  },

  /* задачи */
  tnew() { taskSheet(null); },
  tedit(el) { taskSheet(S.state.tasks.find(t => t.id === +el.dataset.id)); },
  async ttoggle(el) {
    const t = S.state.tasks.find(x => x.id === +el.dataset.id);
    if (!t) return;
    t.done = !t.done;
    haptic(t.done ? 'medium' : 'light');
    render();
    try { await api('/api/tasks/toggle', { id: t.id }); } catch (e) {}
    await reload();
  },
  async tsave(el) {
    const title = $('#t-title').value.trim();
    if (!title) { $('#t-title').focus(); return; }
    const b = { title, day: $('#t-day').value || S.day, remind_time: $('#t-rem').checked ? $('#t-time').value : null };
    if (el.dataset.id) b.id = +el.dataset.id;
    try { await api('/api/tasks', b); } catch (e) { return; }
    closeSheet();
    hapticOk();
    if (b.remind_time) toast(`Напомню ${b.day === S.today ? 'сегодня' : humanDay(b.day).split(',')[0]} в ${b.remind_time}`);
    await reload();
  },
  async ttomorrow(el) {
    const t = S.state.tasks.find(x => x.id === +el.dataset.id);
    try { await api('/api/tasks', { id: t.id, title: t.title, day: addDays(t.day, 1), remind_time: t.remind_time }); } catch (e) { return; }
    closeSheet(); toast('Перенесено на следующий день'); await reload();
  },
  async tdel(el) {
    if (!(await confirmBox('Удалить задачу?'))) return;
    try { await api('/api/tasks/delete', { id: +el.dataset.id }); } catch (e) { return; }
    closeSheet(); await reload();
  },
  async carry() {
    try { await api('/api/tasks/carry', { day: S.state.date }); } catch (e) { return; }
    toast('Задачи перенесены на сегодня'); await reload();
  },

  /* месяц */
  async month(el) {
    S.ym = shiftYm(S.ym, +el.dataset.n);
    haptic('light');
    try { await loadMonth(S.ym); } catch (e) {}
    render();
  },
  mtoggle(el) { S.mclosed[el.dataset.id] = !S.mclosed[el.dataset.id]; render(); },

  /* заметки */
  async nadd() {
    const ta = $('#n-new'), text = ta.value.trim();
    if (!text) { ta.focus(); return; }
    try { await api('/api/notes', { text }); } catch (e) { return; }
    hapticOk(); await reload();
  },
  nedit(el) { noteSheet(S.notes.find(n => n.id === +el.dataset.id)); },
  async nsave(el) {
    const text = $('#n-text').value.trim();
    if (!text) { toast('Заметка пустая'); return; }
    try { await api('/api/notes', { id: +el.dataset.id, text }); } catch (e) { return; }
    closeSheet(); await reload();
  },
  async ndel(el) {
    if (!(await confirmBox('Удалить заметку?'))) return;
    try { await api('/api/notes/delete', { id: +el.dataset.id }); } catch (e) { return; }
    closeSheet(); await reload();
  },

  /* привычки */
  hnew() { habitSheet(null); },
  hedit(el) { habitSheet(S.state.habits.find(h => h.id === +el.dataset.id)); },
  async hmove(el) {
    try { await api('/api/habits/move', { id: +el.dataset.id, dir: +el.dataset.n }); } catch (e) { return; }
    haptic('light'); await reload();
  },
  hkind(el) { S.draft.kind = el.dataset.k; syncHabitSheet(); },
  hstep(el) { S.draft.target = Math.min(6, Math.max(1, S.draft.target + +el.dataset.n)); syncHabitSheet(); },
  hkidadd() {
    $('#h-kids').insertAdjacentHTML('beforeend', kidRow({}));
    const all = $$('#h-kids input');
    all[all.length - 1].focus();
  },
  hkiddel(el) { el.closest('.kid').remove(); },
  async hsave(el) {
    const name = $('#h-name').value.trim();
    if (!name) { $('#h-name').focus(); return; }
    const b = {
      name, kind: S.draft.kind, target: S.draft.target,
      remind_time: $('#h-rem').checked ? $('#h-time').value : null,
    };
    if (b.kind === 'group') {
      b.children = $$('#h-kids input').map(i => ({ id: i.dataset.kid ? +i.dataset.kid : null, name: i.value.trim() })).filter(c => c.name);
      if (!b.children.length) { toast('Добавь хотя бы один пункт'); return; }
    }
    if (el.dataset.id) b.id = +el.dataset.id;
    try { await api('/api/habits', b); } catch (e) { return; }
    closeSheet(); hapticOk(); await reload();
  },
  async hdel(el) {
    if (!(await confirmBox('Удалить привычку? Вся её история тоже удалится.'))) return;
    try { await api('/api/habits/delete', { id: +el.dataset.id }); } catch (e) { return; }
    closeSheet(); await reload();
  },
};

/* ═════════════════════ Ибадат, Еда, Спорт, Ещё ═════════════════════ */

const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const fmtDur = m => { const h = Math.floor(m / 60), mm = m % 60; return h ? `${h} ч ${mm} мин` : `${mm} мин`; };
const r0 = x => Math.round(x);
const r1 = x => Math.round(x * 10) / 10;
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

async function loadIb() { S.ib = await api('/api/ibadah' + (S.day ? `?day=${S.day}` : '')); S.day = S.ib.date; S.today = S.ib.today; }
async function loadFood() { S.food = await api('/api/food' + (S.day ? `?day=${S.day}` : '')); S.day = S.food.date; S.today = S.food.today; }
async function loadWk() { S.wk = await api('/api/workout' + (S.day ? `?day=${S.day}` : '')); S.day = S.wk.date; S.today = S.wk.today; }

function dayHead(d, today) {
  const label = d === today ? 'Сегодня' : d === addDays(today, -1) ? 'Вчера' : d === addDays(today, 1) ? 'Завтра'
    : WD_FULL[wdOf(d)][0].toUpperCase() + WD_FULL[wdOf(d)].slice(1);
  return `<div class="dayhead">
      <button class="iconbtn" data-act="day" data-n="-1" aria-label="Предыдущий день">${ICON.left}</button>
      <div class="daytitle"><div class="big">${label}</div><div class="sub">${humanDay(d)}</div></div>
      <button class="iconbtn" data-act="day" data-n="1" aria-label="Следующий день">${ICON.right}</button>
    </div>${d === today ? '' : '<button class="linkbtn" data-act="gotoday">Вернуться к сегодня</button>'}`;
}

function switchHTML(on) { return `<span class="switch"><input type="checkbox" ${on ? 'checked' : ''} tabindex="-1"><i></i></span>`; }

/* ───────── Ибадат ───────── */
function azkarItems(set) {
  if (set === 'ap') return AFTER_PRAYER.map(x => x.ref ? { ...AZKAR.find(a => a.id === x.ref), id: x.id, n: x.n, note: x.note } : x);
  return AZKAR.filter(a => !a.when || a.when === set).map(a => set === 'e' && a.ar_e
    ? { ...a, title: a.title_e || a.title, ar: a.ar_e, tr: a.tr_e, ru: a.ru_e } : a);
}
const azKey = (set, day) => `az:${day}:${set}`;
function azProgress(set, day) {
  const items = azkarItems(set), c = lsGet(azKey(set, day), {});
  return [items.filter(it => (c[it.id] || 0) >= it.n).length, items.length];
}

function viewIbadah() {
  const I = S.ib;
  if (!I) return loader();
  const M = new Set(I.marks), isToday = I.date === I.today, future = I.date > I.today;
  let hero = '';
  if (isToday) {
    const nowM = toMin(I.now);
    const nx = PRAYER_LIST.find(p => toMin(I.times[p.key]) > nowM);
    const name = nx ? nx.name : 'Фаджр', t = nx ? I.times[nx.key] : I.tomorrow_fajr;
    const diff = (toMin(t) + (nx ? 0 : 1440)) - nowM;
    hero = `<div class="hero"><div><small>Следующий${nx && nx.info ? '' : ' намаз'}</small><b>${name}</b></div>
      <div class="hero-r"><b>${t}</b><small>через ${fmtDur(diff)}</small></div></div>`;
  }
  const fardDone = FARD_KEYS.filter(k => M.has('fard_' + k)).length;
  const rows = PRAYER_LIST.map(p => {
    if (p.info) return `<div class="prow info"><div class="ptime">${I.times[p.key]}</div><div class="pmain"><div class="rtitle">${p.name}</div><div class="rmeta"><span>время намаза Фаджр заканчивается</span></div></div></div>`;
    const fk = 'fard_' + p.key;
    const chips = p.sunnah.map(s => {
      const k = `sun_${p.key}_${s.k}`;
      return `<button class="chip ${M.has(k) ? 'on' : ''} ${future ? 'disabled' : ''}" data-act="mark" data-key="${k}">${s.label}${s.m ? '<i>•</i>' : ''}</button>`;
    }).join('');
    return `<div class="prow ${future ? 'disabled' : ''}">
      <div class="ptime">${I.times[p.key]}</div>
      <div class="pmain"><div class="rtitle">${p.name}</div><div class="chips">${chips}</div></div>
      <button class="check big ${M.has(fk) ? 'on' : ''}" data-act="mark" data-key="${fk}" aria-label="Фард">${ICON.check}</button>
    </div>`;
  }).join('');
  const extra = EXTRA_PRAYERS.map(x => `
    <div class="row ${future ? 'disabled' : ''}" data-act="mark" data-key="${x.key}">
      <span class="check ${M.has(x.key) ? 'on' : ''}">${ICON.check}</span>
      <div class="rmain"><div class="rtitle">${x.name}</div><div class="rmeta"><span>${x.note}</span></div></div>
    </div>`).join('');
  const azRow = (set, name, sub) => {
    const [k, n] = azProgress(set, I.date), done = M.has('azkar_' + set) || (n && k === n);
    return `<div class="row" data-act="azkar" data-set="${set}">
      <span class="ring ${done ? 'full' : ''}" style="--p:${n ? k / n : 0}">${done ? ICON.check : ''}</span>
      <div class="rmain"><div class="rtitle">${name}</div><div class="rmeta"><span>${sub} · ${k} из ${n}</span></div></div>
      <span class="chev">${ICON.right}</span></div>`;
  };
  const tbTotal = lsGet(`tb:${I.date}`, 0);
  return `${dayHead(I.date, I.today)}
    ${hero}
    <div class="sec-h"><span>Намазы</span><small>фард ${fardDone} из 5</small></div>
    <div class="card">${rows}</div>
    <p class="hint">Кружок справа — фард. Кнопки под названием — сунна-намазы (точка • — сунна-муаккада). Фард отмечается и в привычке «Намаз».</p>

    <div class="sec-h"><span>Дополнительно</span></div>
    <div class="card ckl">${extra}
      <div class="row ${future ? 'disabled' : ''}" data-act="mark" data-key="quran">
        <span class="check ${M.has('quran') ? 'on' : ''}">${ICON.check}</span>
        <div class="rmain"><div class="rtitle">Коран</div><div class="rmeta"><span>хотя бы 1 страница</span></div></div>
      </div>
    </div>

    <div class="sec-h"><span>Азкары и зикр</span></div>
    <div class="card ckl">
      ${azRow('m', 'Утренние азкары', 'после Фаджра')}
      ${azRow('e', 'Вечерние азкары', 'после Асра')}
      ${azRow('ap', 'Азкары после намаза', 'после каждого фарда')}
      <div class="row" data-act="tasbih">
        <span class="tbicon">${ICON.tasbih}</span>
        <div class="rmain"><div class="rtitle">Тасбих</div><div class="rmeta"><span>${tbTotal ? `сегодня ${tbTotal}` : 'электронные чётки'}</span></div></div>
        <span class="chev">${ICON.right}</span></div>
    </div>

    <div class="card" style="margin-top:14px">
      <div class="row" data-act="pnotify">
        <div class="rmain"><div class="rtitle">Напоминать о намазе</div><div class="rmeta"><span>бот напишет в начале времени</span></div></div>
        ${switchHTML(I.settings.prayer_notify !== '0')}
      </div>
    </div>
    <p class="hint">Город: <b>${esc(I.city)}</b>. ${I.city.includes('Турция') ? 'Время по методу Diyanet, как в мечетях Турции.' : 'Время по методу Лиги исламского мира (Фаджр 18°, Иша 17°).'} Город и поправки в минутах меняются в «Ещё → Профиль».</p>`;
}
const FARD_KEYS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
const CITY_NAMES = { izmit: 'Измит, Турция', idlib: 'Идлиб, Сирия', harim: 'Харим, Сирия', fuah: 'Фуа, Сирия' };

function azkarSheetHTML(set) {
  const day = S.ib.date, c = lsGet(azKey(set, day), {}), items = azkarItems(set);
  const pref = lsGet('az:pref', { tr: true, ru: true });
  const title = { m: 'Утренние азкары', e: 'Вечерние азкары', ap: 'После намаза' }[set];
  const k = items.filter(it => (c[it.id] || 0) >= it.n).length;
  return `<h3>${title}</h3>
    <div class="seg small">
      <button class="${pref.tr ? 'on' : ''}" data-act="azpref" data-k="tr">Транскрипция</button>
      <button class="${pref.ru ? 'on' : ''}" data-act="azpref" data-k="ru">Перевод</button>
    </div>
    <div class="azprog"><div class="bar"><i style="width:${items.length ? k / items.length * 100 : 0}%"></i></div><span>${k} из ${items.length}</span></div>
    ${items.map(it => {
      const n = c[it.id] || 0, done = n >= it.n;
      return `<div class="zk ${done ? 'done' : ''}" data-act="zk" data-set="${set}" data-id="${it.id}" id="zk-${it.id}">
        <div class="zk-h"><b>${esc(it.title)}</b>${it.note ? `<small>${esc(it.note)}</small>` : ''}</div>
        <div class="ar" dir="rtl" lang="ar">${it.ar}</div>
        ${pref.tr ? `<div class="tr">${esc(it.tr)}</div>` : ''}
        ${pref.ru ? `<div class="ru">${esc(it.ru)}</div>` : ''}
        <div class="zk-c"><span>${done ? ICON.check + 'Готово' : 'Нажми, чтобы засчитать'}</span><b>${Math.min(n, it.n)} / ${it.n}</b></div>
      </div>`;
    }).join('')}
    <button class="btn" data-act="azreset" data-set="${set}">Сбросить счётчики</button>`;
}
function refreshSheet(html) {
  const b = $('#sheet .sheet-body');
  if (!b) return;
  const top = b.scrollTop;
  b.innerHTML = '<div class="grab"></div>' + html;
  b.scrollTop = top;
}

function tasbihHTML() {
  const T = S.tb, P = TASBIH.find(x => x.id === T.preset), st = P.seq[Math.min(T.step, P.seq.length - 1)];
  const finished = T.step >= P.seq.length;
  const total = lsGet(`tb:${S.ib ? S.ib.date : S.today}`, 0);
  const goal = st.n;
  return `<h3>Тасбих</h3>
    <div class="tb-presets">${TASBIH.map(x => `<button class="chip ${x.id === T.preset ? 'on' : ''}" data-act="tbpreset" data-id="${x.id}">${x.name}</button>`).join('')}</div>
    <div class="tb-text">
      ${st.ar ? `<div class="ar" dir="rtl" lang="ar">${st.ar}</div>` : ''}
      <div class="tr">${esc(st.tr)}</div><div class="ru">${esc(st.ru)}</div>
    </div>
    ${P.seq.length > 1 ? `<div class="tb-steps">${P.seq.map((s, i) => `<i class="${i < T.step ? 'ok' : i === T.step ? 'cur' : ''}"></i>`).join('')}</div>` : ''}
    <button class="tb-btn ${finished ? 'fin' : ''}" data-act="tbtap" style="--p:${goal && !finished ? T.count / goal : finished ? 1 : 0}">
      <span><b>${finished ? ICON.check : T.count}</b><small>${finished ? 'Готово' : goal ? `из ${goal}` : 'нажимай'}</small></span>
    </button>
    <div class="btn-row"><button class="btn" data-act="tbreset">Сбросить</button></div>
    <p class="hint" style="text-align:center">Всего за сегодня: ${total}</p>`;
}

/* ───────── Еда ───────── */
function currentWeight(F) {
  const w = F.weights.length ? F.weights[F.weights.length - 1].kg : +F.settings.start_weight;
  return w || 48.5;
}
function calcTargets(st, w) {
  const h = +st.height || 170, a = +st.age || 25;
  const bmr = 10 * w + 6.25 * h - 5 * a + 5;
  const kcal = Math.round((bmr * 1.5 + 500) / 50) * 50;
  const p = Math.round(w * 2), f = Math.round(kcal * 0.27 / 9);
  return { kcal, p, f, c: Math.round((kcal - p * 4 - f * 9) / 4) };
}
const foodById = id => FOODS.find(f => f.id === id);

function sparkline(F, goal) {
  const pts = F.weights;
  if (pts.length < 2) return '';
  const W = 300, H = 70, xs = pts.map(p => parseD(p.day).getTime()), ys = pts.map(p => p.kg);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const y0 = Math.min(...ys) - 0.5, y1 = Math.max(...ys) + 0.5;
  const X = x => x1 === x0 ? W / 2 : 6 + (x - x0) / (x1 - x0) * (W - 12), Y = y => H - 6 - (y - y0) / (y1 - y0) * (H - 12);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(xs[i]).toFixed(1)},${Y(ys[i]).toFixed(1)}`).join('');
  const last = pts.length - 1;
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><path d="${d}"/><circle cx="${X(xs[last])}" cy="${Y(ys[last])}" r="3.5"/></svg>`;
}

function viewFood() {
  const F = S.food;
  if (!F) return loader();
  const w = currentWeight(F), T = calcTargets(F.settings, w), goal = +F.settings.goal_weight || 60;
  const start = +F.settings.start_weight || w;
  const sum = F.items.reduce((a, it) => { a.kcal += it.kcal * it.qty; a.p += it.protein * it.qty; a.f += it.fat * it.qty; a.c += it.carbs * it.qty; return a; }, { kcal: 0, p: 0, f: 0, c: 0 });
  const pct = (x, t) => Math.min(100, t ? x / t * 100 : 0);
  const bar = (name, x, t, cls) => `<div class="mbar ${cls}"><div class="mbar-h"><span>${name}</span><b>${r0(x)}<small> / ${t} г</small></b></div><div class="bar"><i style="width:${pct(x, t)}%"></i></div></div>`;
  const left = T.kcal - r0(sum.kcal);
  const meals = MEALS.map(m => {
    const its = F.items.filter(it => it.meal === m.key);
    if (!its.length && m.key === 'late') return `<div class="sec-h"><span>${m.name}</span></div><div class="card ckl"><div class="row addrow" data-act="fadd" data-meal="${m.key}">${ICON.plus}<span>Добавить</span></div></div>`;
    const kc = its.reduce((a, it) => a + it.kcal * it.qty, 0);
    return `<div class="sec-h"><span>${m.name}</span>${its.length ? `<small>${r0(kc)} ккал</small>` : ''}</div>
      <div class="card ckl">${its.map(it => `
        <div class="row" data-act="fdel" data-id="${it.id}">
          <span class="fdot"></span>
          <div class="rmain"><div class="rtitle">${esc(it.name)}</div><div class="rmeta"><span>${it.qty === 1 ? '1 порция' : `${r1(it.qty)} порц.`} · белок ${r0(it.protein * it.qty)} г</span></div></div>
          <span class="kc">${r0(it.kcal * it.qty)}</span>
        </div>`).join('')}
        <div class="row addrow" data-act="fadd" data-meal="${m.key}">${ICON.plus}<span>Добавить</span></div>
      </div>`;
  }).join('');
  const toGoal = r1(goal - w), gained = r1(w - start);
  return `${dayHead(F.date, F.today)}
    <div class="card macros">
      <div class="kring" style="--p:${pct(sum.kcal, T.kcal) / 100}">
        <div><b>${r0(sum.kcal)}</b><small>из ${T.kcal} ккал</small></div>
      </div>
      <div class="mbars">
        ${bar('Белки', sum.p, T.p, 'p')}${bar('Жиры', sum.f, T.f, 'f')}${bar('Углеводы', sum.c, T.c, 'c')}
      </div>
    </div>
    <p class="hint center">${left > 0 ? `Осталось съесть <b>${left} ккал</b>` : 'Норма на день выполнена 💪'}</p>

    <div class="btn-row">
      <button class="btn" data-act="fplan">${ICON.list}План питания</button>
      <button class="btn" data-act="weight">${ICON.scale}Вес</button>
    </div>

    <div class="card wcard" data-act="weight">
      <div class="wrow">
        <div><small>Сейчас</small><b>${w} кг</b></div>
        <div><small>Набрано</small><b class="${gained >= 0 ? 'pos' : 'neg'}">${gained > 0 ? '+' : ''}${gained} кг</b></div>
        <div><small>До цели</small><b>${toGoal > 0 ? toGoal + ' кг' : 'цель!'}</b></div>
      </div>
      ${sparkline(F, goal)}
    </div>
    ${meals}
    <p class="hint">Норма считается от твоего веса, роста и возраста (Профиль во вкладке «Ещё») с запасом +500 ккал для набора. Взвешивайся раз в неделю утром натощак. Если 2 недели вес стоит — добавь ещё один перекус.</p>`;
}

function foodPickHTML() {
  const P = S.pick;
  if (P.food) {
    const f = P.food, k = f.kcal * P.qty;
    return `<h3>${esc(f.name)}</h3>
      <p class="hint center" style="margin-top:-6px">1 порция = ${esc(f.portion || '1 порция')}</p>
      <div class="field-row"><span>Порций</span>
        <div class="stepper"><button data-act="fqty" data-n="-0.5">−</button><b>${r1(P.qty)}</b><button data-act="fqty" data-n="0.5">+</button></div></div>
      <div class="field-row"><span>Приём пищи</span>
        <select id="f-meal" class="sel">${MEALS.map(m => `<option value="${m.key}" ${m.key === P.meal ? 'selected' : ''}>${m.name}</option>`).join('')}</select></div>
      <div class="fsum"><div><b>${r0(k)}</b><small>ккал</small></div><div><b>${r0(f.p * P.qty)}</b><small>белок</small></div><div><b>${r0(f.f * P.qty)}</b><small>жиры</small></div><div><b>${r0(f.c * P.qty)}</b><small>углев.</small></div></div>
      <button class="btn primary" data-act="fsave">Добавить</button>
      <button class="btn ghost" data-act="fback">Назад к списку</button>
      ${f.custom ? `<button class="btn danger" data-act="fcdel" data-id="${f.cid}">Удалить из моих продуктов</button>` : ''}`;
  }
  if (P.custom) {
    return `<h3>Свой продукт</h3>
      <input id="c-name" class="field" placeholder="Название, например: Мамин плов" maxlength="100">
      <input id="c-portion" class="field mt" placeholder="Порция, например: 1 тарелка" maxlength="40">
      <div class="grid2">
        <label class="lab">Ккал<input id="c-kcal" class="field" inputmode="decimal" placeholder="0"></label>
        <label class="lab">Белок, г<input id="c-p" class="field" inputmode="decimal" placeholder="0"></label>
        <label class="lab">Жиры, г<input id="c-f" class="field" inputmode="decimal" placeholder="0"></label>
        <label class="lab">Углеводы, г<input id="c-c" class="field" inputmode="decimal" placeholder="0"></label>
      </div>
      <button class="btn primary" data-act="fcsave">Сохранить</button>
      <button class="btn ghost" data-act="fback">Назад</button>`;
  }
  return `<h3>Добавить · ${MEALS.find(m => m.key === P.meal).name}</h3>
    <input id="f-q" class="field" placeholder="Поиск продукта" autocomplete="off">
    <div id="f-list" class="flist">${foodListHTML('')}</div>
    <button class="btn" data-act="fcustom">${ICON.plus}Свой продукт</button>`;
}
function allFoods() {
  const custom = (S.food.custom || []).map(c => ({ id: 'c' + c.id, cid: c.id, custom: true, name: c.name, portion: c.portion, kcal: c.kcal, p: c.protein, f: c.fat, c: c.carbs, cat: 'Мои продукты' }));
  return [...custom, ...FOODS];
}
function foodListHTML(qs) {
  const qq = qs.trim().toLowerCase();
  const list = allFoods().filter(f => !qq || f.name.toLowerCase().includes(qq));
  if (!list.length) return '<div class="empty">Не нашёл. Добавь свой продукт ниже.</div>';
  let cat = '', out = '';
  for (const f of list) {
    if (f.cat !== cat) { cat = f.cat; out += `<div class="fcat">${cat}</div>`; }
    out += `<div class="frow" data-act="fpick" data-id="${f.id}"><div><div class="rtitle">${esc(f.name)}</div><div class="rmeta"><span>${esc(f.portion || '')}</span></div></div><b>${r0(f.kcal)}</b></div>`;
  }
  return out;
}
function openFoodSheet() {
  openSheet(foodPickHTML(), () => {
    const q = $('#f-q');
    if (q) q.addEventListener('input', () => { $('#f-list').innerHTML = foodListHTML(q.value); });
  });
}
function rerenderFoodSheet() {
  refreshSheet(foodPickHTML());
  const q = $('#f-q');
  if (q) q.addEventListener('input', () => { $('#f-list').innerHTML = foodListHTML(q.value); });
}

function planHTML() {
  let tk = 0, tp = 0;
  const parts = MEALS.filter(m => MEAL_PLAN[m.key]).map(m => {
    const its = MEAL_PLAN[m.key].map(([id, q]) => ({ f: foodById(id), q }));
    const k = its.reduce((a, x) => a + x.f.kcal * x.q, 0), p = its.reduce((a, x) => a + x.f.p * x.q, 0);
    tk += k; tp += p;
    return `<div class="plan">
      <div class="plan-h"><b>${m.name}</b><span>${r0(k)} ккал · ${r0(p)} г белка</span></div>
      ${its.map(x => `<div class="plan-i"><span>${esc(x.f.name)}${x.q !== 1 ? ` × ${x.q}` : ''}</span><small>${r0(x.f.kcal * x.q)}</small></div>`).join('')}
      <button class="btn small" data-act="fplanadd" data-meal="${m.key}">Добавить в дневник</button>
    </div>`;
  }).join('');
  return `<h3>План питания на день</h3>
    <p class="hint center" style="margin-top:-6px">Около <b>${r0(tk)} ккал</b> и <b>${r0(tp)} г белка</b>. Продукты можно менять на похожие.</p>
    ${parts}
    <p class="hint">Если пока тяжело съесть всё — начни с 3 основных приёмов и гейнера, а перекусы добавляй постепенно. Ешь по часам, даже без аппетита. Гейнер удобно пить после зала.</p>`;
}

function weightHTML() {
  const F = S.food, today = F.weights.find(x => x.day === F.date);
  const recent = F.weights.slice(-8).reverse();
  return `<h3>Вес</h3>
    <div class="field-row"><span>${humanDay(F.date).split(',')[0]}</span>
      <input id="w-kg" class="field small" inputmode="decimal" placeholder="кг" value="${today ? today.kg : ''}"></div>
    <button class="btn primary" data-act="wsave">Сохранить</button>
    ${recent.length ? `<div class="sublabel">Последние записи</div><div class="card inset">${recent.map(x => `<div class="row"><div class="rmain">${humanDay(x.day).split(',')[0]}</div><b>${x.kg} кг</b></div>`).join('')}</div>` : ''}
    <p class="hint">Цель: ${F.settings.goal_weight} кг. Нормальный темп набора — 0,3–0,5 кг в неделю.</p>`;
}

/* ───────── Спорт ───────── */
function wkWhich(W) {
  const todayMark = W.marks.find(k => k.startsWith('workout_'));
  if (S.wkPick) return S.wkPick;
  if (todayMark) return todayMark.slice(8);
  const prev = W.history.filter(h => h.day < W.date);
  if (!prev.length) return 'A';
  return prev[prev.length - 1].key === 'workout_A' ? 'B' : 'A';
}
const setsStr = sets => sets.map(s => s.w ? `${s.w}×${s.r}` : `${s.r}`).join(', ');

function viewSport() {
  const W = S.wk;
  if (!W) return loader();
  const days = (W.settings.train_days || '').split(',').filter(Boolean).map(Number);
  const isTrain = days.includes(wdOf(W.date));
  const which = wkWhich(W), P = PROGRAM[which];
  const doneKey = W.marks.find(k => k.startsWith('workout_'));
  const [mon] = [addDays(W.date, -wdOf(W.date))];
  const hist = new Set(W.history.map(h => h.day));
  const week = WD.map((n, i) => {
    const d = addDays(mon, i);
    return `<div class="wd ${days.includes(i) ? 'td' : ''} ${hist.has(d) || (d === W.date && doneKey) ? 'ok' : ''} ${d === W.date ? 'cur' : ''}"><small>${n}</small><i>${hist.has(d) || (d === W.date && doneKey) ? ICON.check : ''}</i></div>`;
  }).join('');
  const weekDone = WD.filter((_, i) => hist.has(addDays(mon, i)) || (addDays(mon, i) === W.date && doneKey)).length;
  const rows = P.items.map(([id, sets, reps]) => {
    const E = EXERCISES[id], today = W.logs[id], last = W.last[id];
    return `<div class="exrow ${today ? 'logged' : ''}" data-act="ex" data-id="${id}" data-sets="${sets}" data-reps="${reps}">
      <img src="/assets/img/ex/${id}_1.jpg" alt="" loading="lazy">
      <div class="rmain"><div class="rtitle">${E.name}</div>
        <div class="rmeta"><span>${sets} × ${reps}</span></div>
        <div class="rmeta last">${today ? `${ICON.check}<span>сегодня: ${setsStr(today)}</span>` : last ? `<span>прошлый раз: ${setsStr(last.sets)}</span>` : '<span>ещё не делал</span>'}</div>
      </div>
      <span class="chev">${ICON.right}</span></div>`;
  }).join('');
  return `${dayHead(W.date, W.today)}
    <div class="card weekc"><div class="wk-h"><span>Эта неделя</span><b>${weekDone} из ${days.length || 3}</b></div><div class="wdays">${week}</div></div>
    ${!isTrain && !doneKey ? '<p class="hint center">Сегодня по плану отдых. Мышцы растут именно во время отдыха — поешь и выспись 🙂</p>' : ''}
    <div class="seg" style="margin-top:16px">
      <button class="${which === 'A' ? 'on' : ''}" data-act="wkpick" data-k="A">Тренировка A</button>
      <button class="${which === 'B' ? 'on' : ''}" data-act="wkpick" data-k="B">Тренировка B</button>
    </div>
    <div class="sec-h"><span>${P.name}</span><small>~50 мин</small></div>
    <div class="card">${rows}</div>
    <button class="btn ${doneKey ? '' : 'primary'}" data-act="wkdone" data-k="${which}">${doneKey ? ICON.check + 'Тренировка отмечена' : 'Завершить тренировку'}</button>
    <div class="card tips">
      <b>Как тренироваться</b>
      <ul>
        <li>Разминка 5–10 мин: дорожка или велосипед + 1–2 лёгких подхода первого упражнения.</li>
        <li>Отдых между подходами 1,5–2 мин.</li>
        <li>Тренировки A и B чередуются: A → B → A, на следующей неделе B → A → B.</li>
        <li>Сделал все подходы на верхней границе повторов — в следующий раз добавь 2,5 кг (на гантелях — 1 кг).</li>
        <li>Первые 2 недели бери лёгкий вес и учи технику. Боль в суставах — повод остановиться.</li>
        <li>Без еды тренировки не дадут массы: после зала — гейнер или нормальный приём пищи.</li>
      </ul>
    </div>`;
}

function exSheetHTML(id, nSets, reps) {
  const E = EXERCISES[id], W = S.wk, today = W.logs[id], last = W.last[id];
  const base = today || (last ? last.sets : []);
  const n = Math.max(nSets, base.length);
  const isTime = /сек/.test(reps);
  return `<h3>${E.name}</h3>
    <div class="exanim"><img src="/assets/img/ex/${id}_0.jpg" alt=""><img src="/assets/img/ex/${id}_1.jpg" alt=""></div>
    <div class="rmeta center" style="justify-content:center;margin:8px 0 2px"><span>${E.muscles} · ${nSets} × ${reps}</span></div>
    <ul class="extips">${E.tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
    <div class="sublabel">Подходы ${last && !today ? `<small>· прошлый раз ${humanDay(last.day).split(',')[0]}: ${setsStr(last.sets)}</small>` : ''}</div>
    <div id="ex-sets">${Array.from({ length: n }, (_, i) => {
      const s = base[i] || {};
      return `<div class="setrow"><span>${i + 1}</span>
        ${isTime ? '' : `<input class="field" inputmode="decimal" placeholder="кг" value="${s.w ?? ''}" data-w>`}
        <input class="field" inputmode="numeric" placeholder="${isTime ? 'секунд' : 'повторы'}" value="${s.r ?? ''}" data-r></div>`;
    }).join('')}</div>
    <p class="hint">${today ? 'Сегодняшние подходы.' : last ? 'Подставлено с прошлого раза — поменяй на сегодняшние.' : 'Впиши вес и сколько раз сделал.'}</p>
    <button class="btn primary" data-act="exsave" data-id="${id}">Сохранить</button>`;
}

/* ───────── Ещё и профиль ───────── */
function viewMore() {
  const item = (tab, icon, name, sub) => `<div class="row" data-act="tab" data-tab="${tab}"><span class="micon">${icon}</span><div class="rmain"><div class="rtitle">${name}</div><div class="rmeta"><span>${sub}</span></div></div><span class="chev">${ICON.right}</span></div>`;
  return `<h1 class="title">Ещё</h1>
    <div class="card">
      ${item('month', ICON.cal, 'Месяц', 'таблица всех привычек')}
      ${item('notes', ICON.note, 'Заметки', 'быстрые записи')}
      ${item('habits', ICON.list, 'Привычки', 'добавить и изменить')}
      ${item('profile', ICON.user, 'Профиль и цели', 'вес, рост, дни тренировок')}
    </div>`;
}

function viewProfile() {
  const st = S.settings;
  if (!st) return loader();
  const days = (st.train_days || '').split(',').filter(Boolean).map(Number);
  const T = calcTargets(st, +st.start_weight);
  const f = (id, label, v, unit) => `<div class="field-row"><span>${label}</span><div class="unit"><input id="${id}" class="field small" inputmode="decimal" value="${v}"><small>${unit}</small></div></div>`;
  return `<h1 class="title">Профиль и цели</h1>
    <div class="card pad">
      ${f('p-age', 'Возраст', st.age, 'лет')}
      ${f('p-height', 'Рост', st.height, 'см')}
      ${f('p-start', 'Стартовый вес', st.start_weight, 'кг')}
      ${f('p-goal', 'Цель', st.goal_weight, 'кг')}
      <div class="sublabel">Город для времени намазов</div>
      <div class="field-row"><span>Город</span><select id="p-city" class="sel">${Object.entries(CITY_NAMES).map(([k, n]) => `<option value="${k}" ${k === st.city ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
      <div class="sublabel">Поправка времени намаза, минут <small>· например +5 или −3</small></div>
      ${FARD_KEYS.map(k => `<div class="field-row"><span>${PRAYER_LIST.find(p => p.key === k).name}</span><div class="unit"><input id="p-off-${k}" class="field small" inputmode="numeric" value="${+st['off_' + k] || 0}"><small>мин</small></div></div>`).join('')}
      <div class="sublabel">Дни тренировок</div>
      <div class="daypick">${WD.map((n, i) => `<button class="chip ${days.includes(i) ? 'on' : ''}" data-act="pday" data-i="${i}">${n}</button>`).join('')}</div>
      <button class="btn primary" data-act="psave">Сохранить</button>
    </div>
    <p class="hint">При этих данных норма: <b>${T.kcal} ккал</b>, белок ${T.p} г, жиры ${T.f} г, углеводы ${T.c} г. Когда записываешь вес во вкладке «Еда», норма пересчитывается по последнему весу.</p>`;
}

/* ───────── действия ───────── */
Object.assign(ACT, {
  async mark(el) {
    const view = S.tab === 'ibadah' ? S.ib : S.wk;
    if (view.date > view.today) { toast('Будущий день нельзя отметить'); return; }
    const key = el.dataset.key, M = new Set(view.marks), on = !M.has(key);
    on ? M.add(key) : M.delete(key);
    view.marks = [...M];
    haptic(on ? 'medium' : 'light');
    if (on && key.startsWith('fard_') && FARD_KEYS.every(k => M.has('fard_' + k))) hapticOk();
    render();
    try { view.marks = (await api('/api/marks/toggle', { key, day: view.date, on })).marks; } catch (e) { await reload(); }
  },
  async pnotify() {
    const on = S.ib.settings.prayer_notify === '0';
    S.ib.settings.prayer_notify = on ? '1' : '0';
    haptic('light'); render();
    try { await api('/api/settings', { prayer_notify: on }); } catch (e) { await reload(); return; }
    toast(on ? 'Буду напоминать о намазе' : 'Напоминания о намазе выключены');
  },

  /* азкары */
  azkar(el) { const set = el.dataset.set; S.azSet = set; openSheet(azkarSheetHTML(set)); },
  azpref(el) { const p = lsGet('az:pref', { tr: true, ru: true }); p[el.dataset.k] = !p[el.dataset.k]; lsSet('az:pref', p); refreshSheet(azkarSheetHTML(S.azSet)); },
  async zk(el) {
    const set = el.dataset.set, id = el.dataset.id, day = S.ib.date, key = azKey(set, day);
    const c = lsGet(key, {}), it = azkarItems(set).find(x => x.id === id);
    if ((c[id] || 0) >= it.n) return;
    c[id] = (c[id] || 0) + 1;
    lsSet(key, c);
    const done = c[id] >= it.n;
    haptic(done ? 'heavy' : 'light');
    refreshSheet(azkarSheetHTML(set));
    if (done) {
      const items = azkarItems(set), all = items.every(x => (c[x.id] || 0) >= x.n);
      const i = items.findIndex(x => x.id === id), nx = items.slice(i + 1).find(x => (c[x.id] || 0) < x.n);
      if (nx) setTimeout(() => { const e = $('#zk-' + nx.id); e && e.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 150);
      if (all) {
        hapticOk(); toast('Азкары прочитаны. Пусть Аллах примет!');
        if (set !== 'ap' && S.ib.date <= S.ib.today) { try { S.ib.marks = (await api('/api/marks/toggle', { key: 'azkar_' + set, day, on: true })).marks; } catch (e) {} }
      }
    }
    render();
  },
  async azreset(el) {
    if (!(await confirmBox('Сбросить счётчики этого раздела?'))) return;
    lsSet(azKey(el.dataset.set, S.ib.date), {});
    refreshSheet(azkarSheetHTML(el.dataset.set)); render();
  },

  /* тасбих */
  tasbih() { S.tb = S.tb || { preset: 'after', step: 0, count: 0 }; openSheet(tasbihHTML()); },
  tbpreset(el) { S.tb = { preset: el.dataset.id, step: 0, count: 0 }; haptic('light'); refreshSheet(tasbihHTML()); },
  tbtap() {
    const T = S.tb, P = TASBIH.find(x => x.id === T.preset);
    if (T.step >= P.seq.length) { T.step = 0; T.count = 0; refreshSheet(tasbihHTML()); return; }
    T.count++;
    const k = `tb:${S.ib ? S.ib.date : S.today}`; lsSet(k, lsGet(k, 0) + 1);
    const goal = P.seq[T.step].n;
    if (goal && T.count >= goal) {
      T.step++; T.count = 0;
      if (T.step >= P.seq.length) hapticOk(); else haptic('heavy');
    } else haptic('light');
    refreshSheet(tasbihHTML());
  },
  tbreset() { S.tb.step = 0; S.tb.count = 0; refreshSheet(tasbihHTML()); },

  /* еда */
  fadd(el) { S.pick = { meal: el.dataset.meal, food: null, qty: 1, custom: false }; openFoodSheet(); },
  fpick(el) { S.pick.food = allFoods().find(f => f.id === el.dataset.id); S.pick.qty = 1; rerenderFoodSheet(); },
  fqty(el) { S.pick.qty = Math.max(0.5, Math.min(10, S.pick.qty + +el.dataset.n)); rerenderFoodSheet(); },
  fback() { S.pick.food = null; S.pick.custom = false; rerenderFoodSheet(); },
  fcustom() { S.pick.custom = true; rerenderFoodSheet(); setTimeout(() => $('#c-name') && $('#c-name').focus(), 50); },
  async fsave() {
    const P = S.pick, f = P.food, meal = $('#f-meal').value;
    try { await api('/api/food/add', { day: S.food.date, meal, name: f.name, qty: P.qty, kcal: f.kcal, protein: f.p, fat: f.f, carbs: f.c }); } catch (e) { return; }
    closeSheet(); hapticOk(); toast(`+${r0(f.kcal * P.qty)} ккал`); await reload();
  },
  async fcsave() {
    const v = id => $(id).value.trim().replace(',', '.');
    const b = { name: v('#c-name'), portion: v('#c-portion') || '1 порция', kcal: v('#c-kcal') || 0, protein: v('#c-p') || 0, fat: v('#c-f') || 0, carbs: v('#c-c') || 0 };
    if (!b.name) { $('#c-name').focus(); return; }
    let r; try { r = await api('/api/food/custom', b); } catch (e) { return; }
    S.food.custom.push({ id: r.id, name: b.name, portion: b.portion, kcal: +b.kcal, protein: +b.protein, fat: +b.fat, carbs: +b.carbs });
    S.pick.custom = false; S.pick.food = allFoods().find(f => f.id === 'c' + r.id); S.pick.qty = 1;
    rerenderFoodSheet(); hapticOk();
  },
  async fcdel(el) {
    if (!(await confirmBox('Удалить продукт из списка?'))) return;
    try { await api('/api/food/custom/delete', { id: +el.dataset.id }); } catch (e) { return; }
    S.food.custom = S.food.custom.filter(c => c.id !== +el.dataset.id);
    S.pick.food = null; rerenderFoodSheet();
  },
  async fdel(el) {
    const it = S.food.items.find(x => x.id === +el.dataset.id);
    if (!(await confirmBox(`Убрать «${it.name}» из дневника?`))) return;
    try { await api('/api/food/delete', { id: it.id }); } catch (e) { return; }
    await reload();
  },
  fplan() { openSheet(planHTML()); },
  async fplanadd(el) {
    const meal = el.dataset.meal;
    const items = MEAL_PLAN[meal].map(([id, q]) => { const f = foodById(id); return { meal, name: f.name, qty: q, kcal: f.kcal, protein: f.p, fat: f.f, carbs: f.c }; });
    try { await api('/api/food/add', { day: S.food.date, items }); } catch (e) { return; }
    hapticOk(); toast('Добавлено в дневник'); el.textContent = 'Добавлено ✓'; el.disabled = true;
    await loadFood(); render();
  },
  weight() { openSheet(weightHTML(), () => setTimeout(() => $('#w-kg').focus(), 320)); },
  async wsave() {
    const kg = $('#w-kg').value.trim().replace(',', '.');
    try { await api('/api/weight', { day: S.food.date, kg }); } catch (e) { return; }
    closeSheet(); hapticOk(); await reload();
  },

  /* спорт */
  wkpick(el) { S.wkPick = el.dataset.k; haptic('light'); render(); },
  ex(el) { openSheet(exSheetHTML(el.dataset.id, +el.dataset.sets, el.dataset.reps)); },
  async exsave(el) {
    const sets = $$('#ex-sets .setrow').map(r => {
      const w = r.querySelector('[data-w]'), rr = r.querySelector('[data-r]');
      return { w: w ? w.value.trim().replace(',', '.') : 0, r: rr.value.trim() };
    }).filter(s => s.r !== '');
    try { await api('/api/workout/log', { day: S.wk.date, ex: el.dataset.id, sets }); } catch (e) { return; }
    closeSheet(); hapticOk(); await reload();
  },
  async wkdone(el) {
    const W = S.wk;
    if (W.date > W.today) { toast('Будущий день нельзя отметить'); return; }
    const cur = W.marks.find(k => k.startsWith('workout_'));
    const key = cur || 'workout_' + el.dataset.k, on = !cur;
    try { await api('/api/marks/toggle', { key, day: W.date, on }); } catch (e) { return; }
    if (on) { hapticOk(); toast('Красавчик! Тренировка засчитана 💪'); }
    S.wkPick = null; await reload();
  },

  /* профиль */
  pday(el) { el.classList.toggle('on'); haptic('light'); },
  async psave() {
    const v = id => $(id).value.trim().replace(',', '.');
    const train_days = $$('.daypick .chip').map((b, i) => b.classList.contains('on') ? i : null).filter(x => x !== null).join(',');
    const b = { age: v('#p-age'), height: v('#p-height'), start_weight: v('#p-start'), goal_weight: v('#p-goal'), train_days, city: $('#p-city').value };
    FARD_KEYS.forEach(k => { b['off_' + k] = (v('#p-off-' + k) || '0').replace('−', '-').replace('+', ''); });
    try { S.settings = await api('/api/settings', b); } catch (e) { return; }
    S.ib = null;
    hapticOk(); toast('Сохранено'); render();
  },
});

Object.assign(ICON, {
  tasbih: '<svg viewBox="0 0 24 24"><circle cx="12" cy="4.5" r="1.6"/><circle cx="17.3" cy="6.7" r="1.6"/><circle cx="19.5" cy="12" r="1.6"/><circle cx="17.3" cy="17.3" r="1.6"/><circle cx="6.7" cy="6.7" r="1.6"/><circle cx="4.5" cy="12" r="1.6"/><circle cx="6.7" cy="17.3" r="1.6"/><path d="M12 19.5v2.5"/></svg>',
  list: '<svg viewBox="0 0 24 24"><path d="M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01"/></svg>',
  scale: '<svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M8.5 9a5 5 0 0 1 7 0l-2.2 2.5"/></svg>',
  note: '<svg viewBox="0 0 24 24"><path d="M6.5 3.5h7.5l4.5 4.5v12.5h-12z"/><path d="M14 3.5V8h4.5M9.5 12.5h5M9.5 16h5"/></svg>',
  user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.8"/><path d="M4.5 20.5c1.2-3.8 4-5.5 7.5-5.5s6.3 1.7 7.5 5.5"/></svg>',
});

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = ACT[el.dataset.act];
  if (fn) { e.preventDefault(); fn(el, e); }
});

// вернулся в приложение (например, на следующий день) — обновляем данные
document.addEventListener('visibilitychange', () => { if (!document.hidden && !$('#sheet').classList.contains('show')) reload(); });

render();
reload();
