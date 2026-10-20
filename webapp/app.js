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
};

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
    else await loadState(S.day);
  } catch (e) { /* сообщение уже показано */ }
  render();
}

/* ───────── отрисовка ───────── */
const loader = () => '<div class="loader">Загрузка…</div>';

function render() {
  $$('#tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === S.tab));
  const v = $('#view');
  if (S.locked) {
    v.innerHTML = `<div class="locked"><b>Нет доступа</b>${esc(S.locked)}</div>`;
    return;
  }
  v.innerHTML = S.tab === 'month' ? viewMonth() : S.tab === 'notes' ? viewNotes() : S.tab === 'habits' ? viewHabits() : viewToday();
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
    S.day = addDays(S.day, +el.dataset.n);
    haptic('light');
    try { await loadState(S.day); } catch (e) {}
    render();
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
