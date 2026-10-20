"""
Личный трекер привычек: Telegram-бот + мини-приложение.

Один процесс делает всё сразу:
  * веб-сервер: отдаёт мини-приложение и API (/api/...)
  * Telegram-бот: /start, /today, быстрые заметки и задачи текстом
  * напоминания: о задачах и привычках
Данные хранятся в SQLite (один файл).
"""
import asyncio
import hashlib
import hmac
import html
import json
import logging
import os
import re
import sqlite3
import time
from calendar import monthrange
from datetime import date, datetime, timedelta
from pathlib import Path
from urllib.parse import parse_qsl
from zoneinfo import ZoneInfo

from aiohttp import web
from dotenv import load_dotenv

BASE = Path(__file__).resolve().parent
load_dotenv(BASE / ".env")

BOT_TOKEN = os.getenv("BOT_TOKEN", "").strip()
WEBAPP_URL = os.getenv("WEBAPP_URL", "").strip().rstrip("/")
OWNER_ID = int(os.getenv("OWNER_ID", "0") or 0)
TZ = ZoneInfo(os.getenv("TIMEZONE", "Asia/Damascus"))
DB_PATH = os.getenv("DB_PATH", str(BASE / "data" / "habits.db"))
# Если задан DATABASE_URL (postgres://...), данные хранятся в PostgreSQL (например, бесплатный Neon),
# иначе — в файле SQLite по пути DB_PATH.
DATABASE_URL = os.getenv("DATABASE_URL", "").strip()
PG = DATABASE_URL.startswith(("postgres://", "postgresql://"))
# Адрес мини-приложения: WEBAPP_URL или адрес, который Render выдаёт автоматически
WEBAPP_URL = WEBAPP_URL or os.getenv("RENDER_EXTERNAL_URL", "").strip().rstrip("/")
# Сервер сам себя «будит» каждые 10 минут, чтобы бесплатный Render не засыпал
KEEPALIVE_URL = os.getenv("KEEPALIVE_URL", os.getenv("RENDER_EXTERNAL_URL", "")).strip().rstrip("/")
PORT = int(os.getenv("PORT", "8080"))
DEV_MODE = os.getenv("DEV_MODE", "") == "1"  # только для проверки в обычном браузере
WEB_DIR = BASE / "webapp"

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("habits")

MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля",
              "августа", "сентября", "октября", "ноября", "декабря"]
WEEKDAYS = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"]

# Привычки, которые создаются при первом запуске (потом их можно менять в приложении)
DEFAULT_HABITS = [
    ("Намаз", "group", 7, ["Фаджр", "Зухр", "Аср", "Магриб", "Иша"]),
    ("Прочитать книгу", "daily", 7, None),
    ("Спортзал", "weekly", 3, None),
]

# ───────────────────────────── база данных ─────────────────────────────

SCHEMA = """
CREATE TABLE IF NOT EXISTS users(
    user_id BIGINT PRIMARY KEY
);
CREATE TABLE IF NOT EXISTS habits(
    id {ID},
    user_id BIGINT NOT NULL,
    parent_id BIGINT REFERENCES habits(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'daily',
    target INTEGER NOT NULL DEFAULT 7,
    remind_time TEXT,
    last_reminded TEXT,
    sort INTEGER NOT NULL DEFAULT 0,
    created TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS habit_logs(
    habit_id BIGINT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
    day TEXT NOT NULL,
    PRIMARY KEY(habit_id, day)
);
CREATE TABLE IF NOT EXISTS tasks(
    id {ID},
    user_id BIGINT NOT NULL,
    title TEXT NOT NULL,
    day TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0,
    remind_at TEXT,
    reminded INTEGER NOT NULL DEFAULT 0,
    created TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notes(
    id {ID},
    user_id BIGINT NOT NULL,
    text TEXT NOT NULL,
    created TEXT NOT NULL,
    updated TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_user_day ON tasks(user_id, day);
CREATE INDEX IF NOT EXISTS idx_logs_day ON habit_logs(day);
"""
# habits.kind: daily | weekly | group;  target — сколько раз в неделю для weekly
# habits.remind_time: 'HH:MM';  tasks.remind_at: 'YYYY-MM-DDTHH:MM' по местному времени

_conn = None


def _connect():
    if PG:
        import psycopg
        from psycopg.rows import dict_row
        return psycopg.connect(DATABASE_URL, autocommit=True, row_factory=dict_row)
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(DB_PATH, check_same_thread=False)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys=ON")
    c.execute("PRAGMA journal_mode=WAL")
    return c


def _run(sql, args=(), fetch=None):
    """Выполняет запрос. Для PostgreSQL заменяет ? на %s и переподключается,
    если бесплатная база «уснула» и оборвала соединение."""
    global _conn
    if PG:
        import psycopg
        sql = sql.replace("?", "%s")
        for attempt in (0, 1):
            try:
                if _conn is None or _conn.closed:
                    _conn = _connect()
                cur = _conn.execute(sql, args)
                if fetch == "all":
                    return [dict(r) for r in cur.fetchall()]
                if fetch == "one":
                    r = cur.fetchone()
                    return dict(r) if r else None
                return cur
            except psycopg.OperationalError:
                try:
                    _conn and _conn.close()
                except Exception:
                    pass
                _conn = None
                if attempt:
                    raise
                log.info("Соединение с базой оборвалось, переподключаюсь")
    if _conn is None:
        _conn = _connect()
    cur = _conn.execute(sql, args)
    if fetch == "all":
        return [dict(r) for r in cur.fetchall()]
    if fetch == "one":
        r = cur.fetchone()
        return dict(r) if r else None
    _conn.commit()
    return cur


def init_db():
    schema = SCHEMA.replace("{ID}", "BIGSERIAL PRIMARY KEY" if PG else "INTEGER PRIMARY KEY AUTOINCREMENT")
    for stmt in schema.split(";"):
        if stmt.strip():
            _run(stmt)
    log.info("База: %s", "PostgreSQL" if PG else DB_PATH)


def q(sql, *args):
    return _run(sql, args, "all")


def q1(sql, *args):
    return _run(sql, args, "one")


def ex(sql, *args):
    return _run(sql, args)


def insert(sql, *args) -> int:
    """INSERT, который возвращает id новой строки."""
    if PG:
        return _run(sql + " RETURNING id", args, "one")["id"]
    return _run(sql, args).lastrowid


# ───────────────────────────── время ─────────────────────────────

def now_local() -> datetime:
    return datetime.now(TZ)


def today_str() -> str:
    return now_local().date().isoformat()


def stamp() -> str:
    return now_local().strftime("%Y-%m-%dT%H:%M")


class BadRequest(Exception):
    pass


def parse_day(s) -> str:
    try:
        return date.fromisoformat(str(s)).isoformat()
    except ValueError:
        raise BadRequest("Неверная дата")


def norm_time(s):
    if not s:
        return None
    s = str(s).strip()[:5]
    m = re.fullmatch(r"(\d{1,2}):(\d{2})", s)
    if not m or int(m[1]) > 23 or int(m[2]) > 59:
        raise BadRequest("Неверное время")
    return f"{int(m[1]):02d}:{m[2]}"


def human_day(d: str) -> str:
    x = date.fromisoformat(d)
    return f"{x.day} {MONTHS_GEN[x.month - 1]}, {WEEKDAYS[x.weekday()]}"


# ───────────────────────────── данные ─────────────────────────────

def ensure_user(uid: int):
    if q1("SELECT 1 FROM users WHERE user_id=?", uid):
        return
    ex("INSERT INTO users(user_id) VALUES(?)", uid)
    t = today_str()
    for i, (name, kind, target, children) in enumerate(DEFAULT_HABITS):
        hid = insert("INSERT INTO habits(user_id,name,kind,target,sort,created) VALUES(?,?,?,?,?,?)",
                 uid, name, kind, target, i, t)
        for j, c in enumerate(children or []):
            ex("INSERT INTO habits(user_id,parent_id,name,kind,target,sort,created) VALUES(?,?,?,?,?,?,?)",
               uid, hid, c, "daily", 7, j, t)


def habits_tree(uid: int):
    rows = q("SELECT id,parent_id,name,kind,target,remind_time,sort,created FROM habits "
             "WHERE user_id=? ORDER BY sort,id", uid)
    by, top = {}, []
    for r in rows:
        r["children"] = []
        by[r["id"]] = r
    for r in rows:
        if r["parent_id"] and r["parent_id"] in by:
            by[r["parent_id"]]["children"].append(r)
        elif not r["parent_id"]:
            top.append(r)
    return top


def week_bounds(d: str):
    x = date.fromisoformat(d)
    mon = x - timedelta(days=x.weekday())
    return mon.isoformat(), (mon + timedelta(days=6)).isoformat()


def done_set(uid: int, day: str):
    return {r["habit_id"] for r in q(
        "SELECT l.habit_id FROM habit_logs l JOIN habits h ON h.id=l.habit_id "
        "WHERE h.user_id=? AND l.day=?", uid, day)}


def week_counts(uid: int, day: str):
    mon, sun = week_bounds(day)
    return {r["habit_id"]: r["n"] for r in q(
        "SELECT l.habit_id, COUNT(*) n FROM habit_logs l JOIN habits h ON h.id=l.habit_id "
        "WHERE h.user_id=? AND h.kind='weekly' AND l.day BETWEEN ? AND ? GROUP BY l.habit_id",
        uid, mon, sun)}


def task_out(t):
    return {"id": t["id"], "title": t["title"], "day": t["day"], "done": bool(t["done"]),
            "remind_time": t["remind_at"][11:16] if t["remind_at"] else None}


def build_state(uid: int, day: str):
    tasks = q("SELECT * FROM tasks WHERE user_id=? AND day=? "
              "ORDER BY done, COALESCE(remind_at,'9999'), id", uid, day)
    overdue = q1("SELECT COUNT(*) n FROM tasks WHERE user_id=? AND done=0 AND day<?", uid, day)["n"]
    return {
        "today": today_str(),
        "date": day,
        "habits": habits_tree(uid),
        "done": sorted(done_set(uid, day)),
        "week": week_counts(uid, day),
        "tasks": [task_out(t) for t in tasks],
        "overdue": overdue,
    }


def build_month(uid: int, ym: str):
    m = re.fullmatch(r"(\d{4})-(\d{2})", ym or "")
    if not m or not 1 <= int(m[2]) <= 12:
        raise BadRequest("Неверный месяц")
    y, mo = int(m[1]), int(m[2])
    n = monthrange(y, mo)[1]
    first, last = f"{y:04d}-{mo:02d}-01", f"{y:04d}-{mo:02d}-{n:02d}"
    logs = {}
    for r in q("SELECT l.habit_id, l.day FROM habit_logs l JOIN habits h ON h.id=l.habit_id "
               "WHERE h.user_id=? AND l.day BETWEEN ? AND ?", uid, first, last):
        logs.setdefault(r["habit_id"], []).append(int(r["day"][8:]))
    first_log = {r["habit_id"]: r["d"] for r in q(
        "SELECT l.habit_id, MIN(l.day) d FROM habit_logs l JOIN habits h ON h.id=l.habit_id "
        "WHERE h.user_id=? GROUP BY l.habit_id", uid)}
    return {"ym": f"{y:04d}-{mo:02d}", "days": n, "today": today_str(),
            "habits": habits_tree(uid), "logs": logs, "first_log": first_log}


def own_habit(uid, hid):
    h = q1("SELECT * FROM habits WHERE id=? AND user_id=?", int(hid or 0), uid)
    if not h:
        raise BadRequest("Привычка не найдена")
    return h


def own_task(uid, tid):
    t = q1("SELECT * FROM tasks WHERE id=? AND user_id=?", int(tid or 0), uid)
    if not t:
        raise BadRequest("Задача не найдена")
    return t


def set_habit_done(hid: int, day: str, on: bool):
    if on:
        ex("INSERT INTO habit_logs(habit_id, day) VALUES(?,?) ON CONFLICT DO NOTHING", hid, day)
    else:
        ex("DELETE FROM habit_logs WHERE habit_id=? AND day=?", hid, day)


# ───────────────────────────── проверка Telegram ─────────────────────────────

def check_init_data(init_data: str):
    """Проверяет подпись initData от Telegram и возвращает id пользователя."""
    if not init_data or not BOT_TOKEN:
        return None
    pairs = dict(parse_qsl(init_data, keep_blank_values=True))
    received = pairs.pop("hash", None)
    if not received:
        return None
    check_string = "\n".join(f"{k}={v}" for k, v in sorted(pairs.items()))
    secret = hmac.new(b"WebAppData", BOT_TOKEN.encode(), hashlib.sha256).digest()
    calc = hmac.new(secret, check_string.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(calc, received):
        return None
    if time.time() - int(pairs.get("auth_date", 0) or 0) > 7 * 86400:
        return None
    try:
        return int(json.loads(pairs.get("user", "{}"))["id"])
    except (KeyError, ValueError, TypeError):
        return None


# ───────────────────────────── API ─────────────────────────────

routes = web.RouteTableDef()


@web.middleware
async def api_mw(request, handler):
    if not request.path.startswith("/api/"):
        resp = await handler(request)
        resp.headers["Cache-Control"] = "no-cache"
        return resp
    uid = check_init_data(request.headers.get("X-Init-Data", ""))
    if not uid and DEV_MODE:
        uid = OWNER_ID or 1
    if not uid:
        return web.json_response({"error": "Открой приложение через Telegram"}, status=401)
    if OWNER_ID and uid != OWNER_ID:
        return web.json_response({"error": "Это личный бот"}, status=403)
    ensure_user(uid)
    request["uid"] = uid
    try:
        return await handler(request)
    except BadRequest as e:
        return web.json_response({"error": str(e)}, status=400)
    except (ValueError, TypeError, KeyError, json.JSONDecodeError):
        log.exception("bad request")
        return web.json_response({"error": "Неверный запрос"}, status=400)


async def body(request) -> dict:
    data = await request.json()
    if not isinstance(data, dict):
        raise BadRequest("Неверный запрос")
    return data


@routes.get("/")
async def index(request):
    return web.FileResponse(WEB_DIR / "index.html")


@routes.get("/health")
async def health(request):
    return web.json_response({"ok": True})


@routes.get("/api/state")
async def api_state(request):
    day = parse_day(request.query.get("day") or today_str())
    return web.json_response(build_state(request["uid"], day))


@routes.get("/api/month")
async def api_month(request):
    return web.json_response(build_month(request["uid"], request.query.get("ym") or today_str()[:7]))


# привычки

@routes.post("/api/habits/toggle")
async def api_habit_toggle(request):
    uid, b = request["uid"], await body(request)
    h = own_habit(uid, b.get("id"))
    if h["kind"] == "group":
        raise BadRequest("Отмечай пункты внутри группы")
    day = parse_day(b.get("day") or today_str())
    if day > today_str():
        raise BadRequest("Будущий день нельзя отметить")
    exists = q1("SELECT 1 FROM habit_logs WHERE habit_id=? AND day=?", h["id"], day)
    set_habit_done(h["id"], day, not exists)
    return web.json_response({"done": not exists})


@routes.post("/api/habits")
async def api_habit_save(request):
    uid, b = request["uid"], await body(request)
    name = str(b.get("name") or "").strip()[:100]
    if not name:
        raise BadRequest("Введи название")
    kind = b.get("kind") or "daily"
    if kind not in ("daily", "weekly", "group"):
        raise BadRequest("Неверный тип")
    target = max(1, min(7, int(b.get("target") or 3))) if kind == "weekly" else 7
    remind = norm_time(b.get("remind_time"))
    children = [c for c in (b.get("children") or []) if str(c.get("name") or "").strip()]
    if kind == "group" and not children:
        raise BadRequest("Добавь хотя бы один пункт в группу")

    hid = b.get("id")
    if hid:
        h = own_habit(uid, hid)
        if h["parent_id"]:
            raise BadRequest("Пункт группы меняется через саму группу")
        reset = remind != h["remind_time"]
        ex("UPDATE habits SET name=?, kind=?, target=?, remind_time=? WHERE id=?",
           name, kind, target, remind, h["id"])
        if reset:
            ex("UPDATE habits SET last_reminded=NULL WHERE id=?", h["id"])
        if h["kind"] == "group" and kind != "group":
            ex("DELETE FROM habits WHERE parent_id=?", h["id"])
        hid = h["id"]
    else:
        srt = q1("SELECT COALESCE(MAX(sort),-1)+1 s FROM habits WHERE user_id=? AND parent_id IS NULL", uid)["s"]
        hid = insert("INSERT INTO habits(user_id,name,kind,target,remind_time,sort,created) VALUES(?,?,?,?,?,?,?)",
                 uid, name, kind, target, remind, srt, today_str())

    if kind == "group":
        existing = {r["id"] for r in q("SELECT id FROM habits WHERE parent_id=?", hid)}
        keep = set()
        for j, c in enumerate(children):
            cname = str(c["name"]).strip()[:100]
            cid = c.get("id")
            if cid in existing:
                ex("UPDATE habits SET name=?, sort=? WHERE id=?", cname, j, cid)
                keep.add(cid)
            else:
                ex("INSERT INTO habits(user_id,parent_id,name,kind,target,sort,created) VALUES(?,?,?,?,?,?,?)",
                   uid, hid, cname, "daily", 7, j, today_str())
        for cid in existing - keep:
            ex("DELETE FROM habits WHERE id=?", cid)
    wake_reminders()
    return web.json_response({"id": hid})


@routes.post("/api/habits/delete")
async def api_habit_delete(request):
    uid, b = request["uid"], await body(request)
    h = own_habit(uid, b.get("id"))
    ex("DELETE FROM habits WHERE id=?", h["id"])
    return web.json_response({"ok": True})


@routes.post("/api/habits/move")
async def api_habit_move(request):
    uid, b = request["uid"], await body(request)
    h = own_habit(uid, b.get("id"))
    if h["parent_id"]:
        sib = q("SELECT id FROM habits WHERE user_id=? AND parent_id=? ORDER BY sort,id", uid, h["parent_id"])
    else:
        sib = q("SELECT id FROM habits WHERE user_id=? AND parent_id IS NULL ORDER BY sort,id", uid)
    ids = [s["id"] for s in sib]
    i = ids.index(h["id"])
    j = i + (1 if int(b.get("dir") or 1) > 0 else -1)
    if 0 <= j < len(ids):
        ids[i], ids[j] = ids[j], ids[i]
        for k, x in enumerate(ids):
            ex("UPDATE habits SET sort=? WHERE id=?", k, x)
    return web.json_response({"ok": True})


# задачи

@routes.post("/api/tasks")
async def api_task_save(request):
    uid, b = request["uid"], await body(request)
    title = str(b.get("title") or "").strip()[:300]
    if not title:
        raise BadRequest("Введи задачу")
    day = parse_day(b.get("day") or today_str())
    t = norm_time(b.get("remind_time"))
    remind_at = f"{day}T{t}" if t else None
    if b.get("id"):
        old = own_task(uid, b["id"])
        reminded = old["reminded"] if remind_at == old["remind_at"] else 0
        ex("UPDATE tasks SET title=?, day=?, remind_at=?, reminded=? WHERE id=?",
           title, day, remind_at, reminded, old["id"])
        tid = old["id"]
    else:
        tid = insert("INSERT INTO tasks(user_id,title,day,remind_at,created) VALUES(?,?,?,?,?)",
                 uid, title, day, remind_at, stamp())
    wake_reminders()
    return web.json_response({"id": tid})


@routes.post("/api/tasks/toggle")
async def api_task_toggle(request):
    uid, b = request["uid"], await body(request)
    t = own_task(uid, b.get("id"))
    ex("UPDATE tasks SET done=? WHERE id=?", 0 if t["done"] else 1, t["id"])
    wake_reminders()
    return web.json_response({"done": not t["done"]})


@routes.post("/api/tasks/delete")
async def api_task_delete(request):
    uid, b = request["uid"], await body(request)
    t = own_task(uid, b.get("id"))
    ex("DELETE FROM tasks WHERE id=?", t["id"])
    return web.json_response({"ok": True})


@routes.post("/api/tasks/carry")
async def api_task_carry(request):
    """Переносит все невыполненные задачи с прошлых дней на указанный день."""
    uid, b = request["uid"], await body(request)
    day = parse_day(b.get("day") or today_str())
    for t in q("SELECT * FROM tasks WHERE user_id=? AND done=0 AND day<?", uid, day):
        remind_at = f"{day}T{t['remind_at'][11:16]}" if t["remind_at"] else None
        ex("UPDATE tasks SET day=?, remind_at=?, reminded=0 WHERE id=?", day, remind_at, t["id"])
    wake_reminders()
    return web.json_response({"ok": True})


# заметки

@routes.get("/api/notes")
async def api_notes(request):
    return web.json_response({"notes": q(
        "SELECT id,text,created,updated FROM notes WHERE user_id=? ORDER BY updated DESC, id DESC",
        request["uid"])})


@routes.post("/api/notes")
async def api_note_save(request):
    uid, b = request["uid"], await body(request)
    text = str(b.get("text") or "").strip()[:5000]
    if not text:
        raise BadRequest("Пустая заметка")
    if b.get("id"):
        n = q1("SELECT id FROM notes WHERE id=? AND user_id=?", int(b["id"]), uid)
        if not n:
            raise BadRequest("Заметка не найдена")
        ex("UPDATE notes SET text=?, updated=? WHERE id=?", text, stamp(), n["id"])
        return web.json_response({"id": n["id"]})
    nid = insert("INSERT INTO notes(user_id,text,created,updated) VALUES(?,?,?,?)",
             uid, text, stamp(), stamp())
    return web.json_response({"id": nid})


@routes.post("/api/notes/delete")
async def api_note_delete(request):
    uid, b = request["uid"], await body(request)
    ex("DELETE FROM notes WHERE id=? AND user_id=?", int(b.get("id") or 0), uid)
    return web.json_response({"ok": True})


def make_app() -> web.Application:
    app = web.Application(middlewares=[api_mw])
    app.add_routes(routes)
    app.router.add_static("/assets/", WEB_DIR)
    return app


# ───────────────────────────── бот ─────────────────────────────

def today_summary(uid: int) -> str:
    st = build_state(uid, today_str())
    done = set(st["done"])
    lines = [f"<b>{human_day(st['date']).capitalize()}</b>", "", "<b>Привычки</b>"]
    for h in st["habits"]:
        name = html.escape(h["name"])
        if h["kind"] == "group":
            n = sum(c["id"] in done for c in h["children"])
            tot = len(h["children"])
            lines.append(f"{'✅' if n == tot and tot else '◻️'} {name} — {n}/{tot}")
        elif h["kind"] == "weekly":
            w = st["week"].get(h["id"], 0)
            lines.append(f"{'✅' if h['id'] in done else '◻️'} {name} — {w}/{h['target']} за неделю")
        else:
            lines.append(f"{'✅' if h['id'] in done else '◻️'} {name}")
    lines += ["", "<b>Задачи</b>"]
    if not st["tasks"]:
        lines.append("Задач на сегодня нет")
    for t in st["tasks"]:
        tm = f" · {t['remind_time']}" if t["remind_time"] else ""
        lines.append(f"{'✅' if t['done'] else '◻️'} {html.escape(t['title'])}{tm}")
    return "\n".join(lines)


def build_dispatcher():
    from aiogram import Dispatcher, F
    from aiogram.filters import Command, CommandStart
    from aiogram.types import (CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup,
                               Message, WebAppInfo)

    dp = Dispatcher()
    if OWNER_ID:
        dp.message.filter(F.from_user.id == OWNER_ID)
        dp.callback_query.filter(F.from_user.id == OWNER_ID)

    def open_kb():
        if WEBAPP_URL.startswith("https://"):
            return InlineKeyboardMarkup(inline_keyboard=[[
                InlineKeyboardButton(text="Открыть трекер", web_app=WebAppInfo(url=WEBAPP_URL))]])
        return None

    @dp.message(CommandStart())
    async def cmd_start(m: Message):
        ensure_user(m.from_user.id)
        await m.answer(
            "Привет! Это твой личный трекер привычек и задач.\n\n"
            "• Открой приложение кнопкой ниже или через меню слева от поля ввода\n"
            "• /today — сводка за сегодня\n"
            "• Просто напиши мне текст — сохраню как задачу или заметку",
            reply_markup=open_kb())

    @dp.message(Command("today"))
    async def cmd_today(m: Message):
        ensure_user(m.from_user.id)
        await m.answer(today_summary(m.from_user.id), reply_markup=open_kb())

    @dp.message(Command("id"))
    async def cmd_id(m: Message):
        await m.answer(f"Твой Telegram ID: <code>{m.from_user.id}</code>")

    @dp.message(F.text & ~F.text.startswith("/"))
    async def quick_add(m: Message):
        kb = InlineKeyboardMarkup(inline_keyboard=[[
            InlineKeyboardButton(text="📌 Задача на сегодня", callback_data="add:t"),
            InlineKeyboardButton(text="📝 Заметка", callback_data="add:n")]])
        await m.reply("Куда сохранить?", reply_markup=kb)

    @dp.callback_query(F.data.startswith("add:"))
    async def cb_add(cb: CallbackQuery):
        uid = cb.from_user.id
        ensure_user(uid)
        src = cb.message.reply_to_message if cb.message else None
        text = (src.text or "").strip() if src else ""
        if not text:
            await cb.answer("Не нашёл текст, напиши ещё раз", show_alert=True)
            return
        if cb.data == "add:t":
            ex("INSERT INTO tasks(user_id,title,day,created) VALUES(?,?,?,?)",
               uid, text[:300], today_str(), stamp())
            await cb.message.edit_text("📌 Добавил в задачи на сегодня")
        else:
            ex("INSERT INTO notes(user_id,text,created,updated) VALUES(?,?,?,?)",
               uid, text[:5000], stamp(), stamp())
            await cb.message.edit_text("📝 Сохранил в заметки")
        await cb.answer()

    @dp.callback_query(F.data.startswith("td:"))
    async def cb_task_done(cb: CallbackQuery):
        t = q1("SELECT * FROM tasks WHERE id=? AND user_id=?", int(cb.data[3:]), cb.from_user.id)
        if t:
            ex("UPDATE tasks SET done=1 WHERE id=?", t["id"])
            await cb.message.edit_text(f"✅ <s>{html.escape(t['title'])}</s>")
        await cb.answer("Готово")

    @dp.callback_query(F.data.startswith("ts:"))
    async def cb_task_snooze(cb: CallbackQuery):
        t = q1("SELECT * FROM tasks WHERE id=? AND user_id=?", int(cb.data[3:]), cb.from_user.id)
        if t:
            at = (now_local() + timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M")
            ex("UPDATE tasks SET remind_at=?, reminded=0 WHERE id=?", at, t["id"])
            wake_reminders()
            await cb.message.edit_text(f"⏰ Напомню в {at[11:]}: {html.escape(t['title'])}")
        await cb.answer()

    @dp.callback_query(F.data.startswith("hd:"))
    async def cb_habit_done(cb: CallbackQuery):
        _, hid, day = cb.data.split(":")
        h = q1("SELECT * FROM habits WHERE id=? AND user_id=?", int(hid), cb.from_user.id)
        if h and h["kind"] != "group":
            set_habit_done(h["id"], day, True)
            await cb.message.edit_text(f"✅ {html.escape(h['name'])} — отмечено")
        await cb.answer("Отмечено")

    return dp


# ───────────────────────────── напоминания ─────────────────────────────

REMIND_WINDOW_MIN = 180  # если сервер был выключен, не присылать напоминания старше 3 часов


async def check_reminders(bot):
    from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup

    now = now_local()
    now_s = now.strftime("%Y-%m-%dT%H:%M")
    today = now.date().isoformat()

    # задачи
    for t in q("SELECT * FROM tasks WHERE done=0 AND reminded=0 AND remind_at IS NOT NULL AND remind_at<=?",
               now_s):
        ex("UPDATE tasks SET reminded=1 WHERE id=?", t["id"])
        kb = InlineKeyboardMarkup(inline_keyboard=[[
            InlineKeyboardButton(text="✅ Выполнено", callback_data=f"td:{t['id']}"),
            InlineKeyboardButton(text="⏰ Через час", callback_data=f"ts:{t['id']}")]])
        try:
            await bot.send_message(t["user_id"], f"🔔 <b>Напоминание</b>\n{html.escape(t['title'])}",
                                   reply_markup=kb)
        except Exception as e:
            log.warning("Не удалось отправить напоминание о задаче %s: %s", t["id"], e)

    # привычки
    for h in q("SELECT * FROM habits WHERE remind_time IS NOT NULL "
               "AND (last_reminded IS NULL OR last_reminded<?)", today):
        hh, mm = map(int, h["remind_time"].split(":"))
        due = now.replace(hour=hh, minute=mm, second=0, microsecond=0)
        if now < due:
            continue
        ex("UPDATE habits SET last_reminded=? WHERE id=?", today, h["id"])
        if (now - due).total_seconds() > REMIND_WINDOW_MIN * 60:
            continue
        done = done_set(h["user_id"], today)
        name = html.escape(h["name"])
        kb = None
        if h["kind"] == "group":
            kids = q("SELECT id,name FROM habits WHERE parent_id=? ORDER BY sort,id", h["id"])
            left = [k for k in kids if k["id"] not in done]
            if not left:
                continue
            text = f"🔔 <b>{name}</b>\nЕщё не отмечено: " + ", ".join(html.escape(k["name"]) for k in left)
        else:
            if h["id"] in done:
                continue
            if h["kind"] == "weekly" and week_counts(h["user_id"], today).get(h["id"], 0) >= h["target"]:
                continue
            text = f"🔔 Не забудь: <b>{name}</b>"
            kb = InlineKeyboardMarkup(inline_keyboard=[[
                InlineKeyboardButton(text="✅ Отметить", callback_data=f"hd:{h['id']}:{today}")]])
        try:
            await bot.send_message(h["user_id"], text, reply_markup=kb)
        except Exception as e:
            log.warning("Не удалось отправить напоминание о привычке %s: %s", h["id"], e)


MAX_SLEEP = 3600  # даже без напоминаний проверяем базу не чаще раза в час


def next_check_delay() -> float:
    """Через сколько секунд ближайшее напоминание.
    Цикл не опрашивает базу постоянно: бесплатная база (Neon) засыпает,
    когда к ней не обращаются, и так экономится её лимит."""
    now = now_local()
    today = now.date().isoformat()
    tomorrow = datetime.combine(now.date() + timedelta(days=1), datetime.min.time(), TZ)
    times = [tomorrow + timedelta(seconds=5)]
    r = q1("SELECT MIN(remind_at) m FROM tasks WHERE done=0 AND reminded=0 AND remind_at IS NOT NULL")
    if r and r["m"]:
        times.append(datetime.strptime(r["m"], "%Y-%m-%dT%H:%M").replace(tzinfo=TZ))
    for h in q("SELECT DISTINCT remind_time FROM habits WHERE remind_time IS NOT NULL "
               "AND (last_reminded IS NULL OR last_reminded<?)", today):
        hh, mm = map(int, h["remind_time"].split(":"))
        times.append(now.replace(hour=hh, minute=mm, second=0, microsecond=0))
    delay = (min(times) - now).total_seconds() + 1
    return max(1.0, min(delay, MAX_SLEEP))


_wake = asyncio.Event()


def wake_reminders():
    """Вызывается, когда меняются задачи или привычки: пересчитать время ближайшего напоминания."""
    _wake.set()


async def reminder_loop(bot):
    while True:
        try:
            await check_reminders(bot)
            delay = next_check_delay()
        except Exception:
            log.exception("Ошибка в напоминаниях")
            delay = 60
        try:
            await asyncio.wait_for(_wake.wait(), timeout=delay)
        except asyncio.TimeoutError:
            pass
        _wake.clear()


async def keepalive_loop():
    """Раз в 10 минут обращается к своему же адресу, чтобы бесплатный Render не усыплял сервер."""
    from aiohttp import ClientSession, ClientTimeout
    await asyncio.sleep(60)
    async with ClientSession(timeout=ClientTimeout(total=30)) as s:
        while True:
            try:
                async with s.get(f"{KEEPALIVE_URL}/health") as r:
                    await r.read()
            except Exception as e:
                log.warning("keepalive: %s", e)
            await asyncio.sleep(600)


# ───────────────────────────── запуск ─────────────────────────────

async def main():
    if os.getenv("RENDER") and not PG:
        log.warning("ВНИМАНИЕ: DATABASE_URL не задан — на Render данные сотрутся при перезапуске!")
    init_db()
    runner = web.AppRunner(make_app())
    await runner.setup()
    await web.TCPSite(runner, "0.0.0.0", PORT).start()
    log.info("Веб-сервер запущен на порту %s", PORT)
    if KEEPALIVE_URL.startswith("https://"):
        asyncio.create_task(keepalive_loop())
        log.info("Keepalive включён: %s/health", KEEPALIVE_URL)

    if not BOT_TOKEN:
        log.warning("BOT_TOKEN не задан — работает только веб-часть")
        await asyncio.Event().wait()
        return

    from aiogram import Bot
    from aiogram.client.default import DefaultBotProperties
    from aiogram.enums import ParseMode
    from aiogram.types import BotCommand, MenuButtonWebApp, WebAppInfo

    bot = Bot(BOT_TOKEN, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
    try:
        await bot.set_my_commands([
            BotCommand(command="start", description="Открыть трекер"),
            BotCommand(command="today", description="Сводка за сегодня"),
            BotCommand(command="id", description="Мой Telegram ID"),
        ])
        if WEBAPP_URL.startswith("https://"):
            await bot.set_chat_menu_button(menu_button=MenuButtonWebApp(
                text="Трекер", web_app=WebAppInfo(url=WEBAPP_URL)))
        else:
            log.warning("WEBAPP_URL должен начинаться с https:// — кнопка приложения не установлена")
    except Exception as e:
        log.warning("Не удалось настроить меню бота: %s", e)

    asyncio.create_task(reminder_loop(bot))
    await build_dispatcher().start_polling(bot)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except (KeyboardInterrupt, SystemExit):
        pass
