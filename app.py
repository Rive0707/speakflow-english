from fastapi import FastAPI, HTTPException, Query, Header
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pathlib import Path
from urllib.parse import urlparse, parse_qs
import re
import json
import html
import sqlite3
import os
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pydantic import BaseModel, Field


BASE = Path(__file__).resolve().parent
STATIC = BASE / "static"
app = FastAPI(title="SpeakFlow Caption API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET", "POST", "OPTIONS"], allow_headers=["*"])
DB_PATH = Path(os.environ.get("SPEAKFLOW_DB_PATH", str(BASE / "speakflow.sqlite3")))
SYNC_TOKEN = os.environ.get("SPEAKFLOW_SYNC_TOKEN", "").strip()
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()


def init_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH) as con:
        con.execute("""CREATE TABLE IF NOT EXISTS phrases (
            id TEXT PRIMARY KEY, en TEXT NOT NULL, ja TEXT DEFAULT '', context TEXT DEFAULT '',
            vid TEXT DEFAULT '', t REAL DEFAULT 0, title TEXT DEFAULT '', created TEXT DEFAULT '', source TEXT DEFAULT 'netflix'
        )""")


init_db()


def check_sync_token(token: str | None):
    if SYNC_TOKEN and token != SYNC_TOKEN:
        raise HTTPException(401, "同期トークンが違います")


def supabase_request(method: str, path: str, payload=None):
    if not (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY):
        raise RuntimeError("Supabaseの環境変数が設定されていません")
    url = SUPABASE_URL + "/rest/v1/" + path
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=body, method=method, headers={
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": "Bearer " + SUPABASE_SERVICE_ROLE_KEY,
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal"
    })
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            raw = response.read().decode("utf-8", errors="replace")
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")[:400]
        raise HTTPException(e.code, "Supabaseエラー: " + detail)
    except Exception as e:
        raise HTTPException(502, "Supabase接続エラー: " + str(e)[:250])


class PhraseIn(BaseModel):
    id: str | None = None
    en: str = Field(min_length=1, max_length=2000)
    ja: str = ""
    context: str = ""
    vid: str = ""
    t: float = 0
    title: str = ""
    created: str = ""
    source: str = "netflix"


class PhraseBatch(BaseModel):
    phrases: list[PhraseIn]


def get_video_id(url: str) -> str:
    try:
        u = urlparse(url)
        host = (u.hostname or "").lower()
        if host == "youtu.be":
            return u.path.strip("/").split("/")[0]
        if host in {"youtube.com", "www.youtube.com", "m.youtube.com"}:
            if u.path == "/watch":
                return parse_qs(u.query).get("v", [""])[0]
            parts = [x for x in u.path.split("/") if x]
            if len(parts) >= 2 and parts[0] in {"embed", "shorts", "live"}:
                return parts[1]
    except Exception:
        pass
    return ""


def choose_track(track_map: dict, lang: str):
    keys = [lang, lang + "-orig"]
    if lang == "en":
        keys += [k for k in track_map if k.startswith("en-")]
    elif lang == "ja":
        keys += [k for k in track_map if k.startswith("ja-")]
    for key in keys:
        entries = track_map.get(key)
        if entries:
            # Prefer VTT because it preserves cue timing and is easy to parse.
            return key, sorted(entries, key=lambda x: (x.get("ext") != "vtt", x.get("ext") != "json3"))[0]
    return None, None


SENT_END = re.compile(r"[.!?…。！？][\"')\]]*$")


def merge_sentences(cues, max_chars=80, max_span=7.0, gap=1.2, min_chars=15):
    """自動字幕の細切れcueを、文末記号・長さ・無音の間隔でまとまりにする。"""
    out, cur = [], None
    for c in cues:
        if cur is not None:
            too_long = len(cur["text"]) >= max_chars or c["end"] - cur["start"] > max_span
            ended = len(cur["text"]) >= min_chars and SENT_END.search(cur["text"])
            if too_long or ended or c["start"] - cur["end"] > gap:
                out.append(cur)
                cur = None
        if cur is None:
            cur = dict(c)
        else:
            cur["text"] = (cur["text"] + " " + c["text"]).strip()
            cur["end"] = c["end"]
    if cur:
        out.append(cur)
    return out


def parse_vtt(raw: str, merge: bool = True):
    raw = raw.replace("\r", "").replace("\ufeff", "")
    time_re = re.compile(r"(?:(\d{1,2}):)?(\d{2}):(\d{2})[.,](\d{3})")
    def sec(m):
        h = int(m.group(1) or 0); mm = int(m.group(2)); ss = int(m.group(3)); ms = int(m.group(4))
        return h*3600 + mm*60 + ss + ms/1000
    def clean(line):
        line = re.sub(r"<[^>]*>", "", line)
        line = html.unescape(line).replace("\u00a0", " ")
        return re.sub(r"\s+", " ", line).strip()

    # YouTube自動字幕は「行が重なって流れる」形式(インラインのタイムタグ付き)
    auto = bool(re.search(r"<\d{2}:\d{2}:\d{2}[.,]\d{3}>|<c[ >.]", raw))

    # 行単位で解析。cueの終わりは「完全な空行」だけ(YouTubeはcue内に " " の行を入れるため)
    cues = []
    cur = None
    for line in raw.split("\n"):
        if "-->" in line:
            left, right = line.split("-->", 1)
            a = time_re.search(left); b = time_re.search(right)
            cur = {"start": sec(a), "end": sec(b), "lines": []} if a and b else None
            if cur: cues.append(cur)
            continue
        if line == "":
            cur = None
            continue
        if cur is not None:
            t = clean(line)
            if t:
                cur["lines"].append(t)

    out = []
    if auto:
        prev = set()
        for c in cues:
            fresh = [l for l in c["lines"] if l not in prev]
            prev = set(c["lines"])
            text = " ".join(fresh).strip()
            if text and (not out or out[-1]["text"] != text):
                out.append({"start": c["start"], "end": c["end"], "text": text})
        # 次の字幕が出るまで表示されているので、終了時刻を次の開始に合わせる
        for i in range(len(out) - 1):
            if 0 <= out[i+1]["start"] - out[i]["end"] < 2:
                out[i]["end"] = out[i+1]["start"]
        if merge:
            out = merge_sentences(out)
    else:
        for c in cues:
            text = " ".join(c["lines"]).strip()
            if text:
                out.append({"start": c["start"], "end": c["end"], "text": text})
    return out


def parse_json3(raw: str):
    data = json.loads(raw)
    cues=[]
    for event in data.get("events", []):
        segs=event.get("segs") or []
        text="".join(s.get("utf8", "") for s in segs).strip()
        if not text: continue
        start=event.get("tStartMs",0)/1000
        end=(event.get("tStartMs",0)+event.get("dDurationMs",0))/1000
        cues.append({"start":start,"end":end,"text":text})
    return cues


def download_track(ydl, track, merge=True):
    url=track.get("url")
    if not url: return []
    response=ydl.urlopen(url)
    raw=response.read().decode("utf-8", errors="replace")
    ext=track.get("ext", "vtt")
    if ext == "json3" or raw.lstrip().startswith('{'):
        return parse_json3(raw)
    return parse_vtt(raw, merge)


@app.get("/api/health")
def health():
    return {"ok": True, "service": "SpeakFlow captions"}


@app.get("/api/captions")
def captions(url: str = Query(..., min_length=8, max_length=2048), merge: bool = Query(True)):
    video_id=get_video_id(url)
    if not re.fullmatch(r"[\w-]{11}", video_id or ""):
        raise HTTPException(400, "YouTube URLを正しく入力してください")
    url=f"https://www.youtube.com/watch?v={video_id}"
    opts={"quiet":True,"no_warnings":True,"skip_download":True,"noplaylist":True,"socket_timeout":20}
    try:
        from yt_dlp import YoutubeDL
        with YoutubeDL(opts) as ydl:
            info=ydl.extract_info(url, download=False)
            manual=info.get("subtitles") or {}
            auto=info.get("automatic_captions") or {}
            en_key,en_track=choose_track(manual,"en")
            en_source="手動字幕"
            if not en_track:
                en_key,en_track=choose_track(auto,"en")
                en_source="自動生成字幕"
            ja_key,ja_track=choose_track(manual,"ja")
            ja_source="手動字幕" if ja_track else ""
            if not ja_track:
                ja_key,ja_track=choose_track(auto,"ja")
                ja_source="自動生成/翻訳字幕" if ja_track else ""
            if not en_track:
                raise HTTPException(404,"この動画から英語字幕が見つかりませんでした")
            english=download_track(ydl,en_track,merge)
            japanese=download_track(ydl,ja_track,False) if ja_track else []
            if not english:
                raise HTTPException(404,"英語字幕トラックはありましたが、字幕本文を取得できませんでした")
            return {"video_id":video_id,"title":info.get("title",""),"english":english,"japanese":japanese,"english_language":en_key,"japanese_language":ja_key,"english_source":en_source,"japanese_source":ja_source or "日本語字幕なし"}
    except HTTPException:
        raise
    except Exception as e:
        msg=str(e)
        if len(msg)>300: msg=msg[:300]
        raise HTTPException(502,"YouTube字幕の取得に失敗しました: "+msg)



@app.get("/api/phrases")
def get_phrases(x_speakflow_token: str | None = Header(default=None)):
    check_sync_token(x_speakflow_token)
    if SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY:
        rows = supabase_request("GET", "phrases?select=*&order=created.desc") or []
        return {"phrases": rows}
    with sqlite3.connect(DB_PATH) as con:
        con.row_factory = sqlite3.Row
        rows = con.execute("SELECT * FROM phrases ORDER BY created DESC").fetchall()
    return {"phrases": [dict(r) for r in rows]}


@app.post("/api/phrases")
def save_phrases(batch: PhraseBatch, x_speakflow_token: str | None = Header(default=None)):
    check_sync_token(x_speakflow_token)
    now = datetime.now(timezone.utc).isoformat()
    items = []
    for i, item in enumerate(batch.phrases):
        data = item.model_dump()
        data["id"] = str(data.get("id") or f"sf-{int(datetime.now(timezone.utc).timestamp()*1000)}-{i}")
        data["created"] = data.get("created") or now
        items.append(data)
    if SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY:
        if items:
            supabase_request("POST", "phrases?on_conflict=id", items)
        return {"ok": True, "saved": len(items), "storage": "supabase"}
    with sqlite3.connect(DB_PATH) as con:
        for data in items:
            con.execute("""INSERT INTO phrases(id,en,ja,context,vid,t,title,created,source)
                VALUES(:id,:en,:ja,:context,:vid,:t,:title,:created,:source)
                ON CONFLICT(id) DO UPDATE SET en=excluded.en,ja=excluded.ja,context=excluded.context,
                vid=excluded.vid,t=excluded.t,title=excluded.title,source=excluded.source""", data)
    return {"ok": True, "saved": len(items), "storage": "sqlite"}

@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")

app.mount("/", StaticFiles(directory=STATIC, html=True), name="static")
