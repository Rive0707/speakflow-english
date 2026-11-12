// SpeakFlow captions Worker (Cloudflare Workers, 無料枠)
// 役割: PWA からの字幕取得リクエストを中継する。
//   PWA -> このWorker -> YouTube (youtubei/v1/player -> 署名付きtimedtext)
// Render のサーバーIPは YouTube にブロックされるが、Cloudflare の
// エッジネットワークからのリクエストはブロックされにくい、という前提の実験用。
// 返す形は Render の /api/captions と同じ:
//   { video_id, title, english:[{start,end,text}], japanese:[...],
//     english_source, japanese_source }
//
// デプロイ方法 (Cloudflareダッシュボード):
//   1. https://dash.cloudflare.com で無料アカウント作成
//   2. Workers & Pages -> Create Worker -> このファイルの中身を貼り付けて Deploy
//   3. 発行された https://<名前>.workers.dev を PWA の設定に入れる
//
// 注意: 100%の保証はない。YouTube が Cloudflare のIPも弾くようになったら
// 使えなくなる。その場合は Termux共有 / Capacitor APK化などが次の候補。

const ALLOWED_ORIGINS = [
  "https://speakflow-english-dtmo.onrender.com",
  "http://localhost:8000",
  "http://localhost:8005",
  "http://127.0.0.1:8005",
];

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "";
  const headers = {
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
  if (!origin) {
    // curl など Origin なしのリクエストは許可
    headers["Access-Control-Allow-Origin"] = "*";
  } else if (ALLOWED_ORIGINS.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  // 許可外の Origin には ACAO を付けない (ブラウザがブロックする)
  return headers;
}

function jsonResponse(request, obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(request) },
  });
}

const SENT_END = /[.!?…。！？]["')\]]*$/;

function mergeSentences(cues, maxChars = 80, maxSpan = 7.0, gap = 1.2, minChars = 15) {
  // app.py の merge_sentences と同じ考え方: 細切れの自動字幕を文のまとまりにする
  const out = [];
  let cur = null;
  for (const c of cues) {
    if (cur !== null) {
      const tooLong = cur.text.length >= maxChars || c.end - cur.start > maxSpan;
      const ended = cur.text.length >= minChars && SENT_END.test(cur.text);
      if (tooLong || ended || c.start - cur.end > gap) {
        out.push(cur);
        cur = null;
      }
    }
    if (cur === null) {
      cur = { ...c };
    } else {
      cur.text = (cur.text + " " + c.text).trim();
      cur.end = c.end;
    }
  }
  if (cur) out.push(cur);
  return out;
}

function parseJson3(raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  const cues = [];
  for (const event of data.events || []) {
    const text = (event.segs || []).map((s) => s.utf8 || "").join("").trim();
    if (!text) continue;
    const start = (event.tStartMs || 0) / 1000;
    const end = ((event.tStartMs || 0) + (event.dDurationMs || 0)) / 1000;
    cues.push({ start, end, text });
  }
  return cues;
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function parseXmlTranscript(raw) {
  // timedtext が fmt=json3 を無視して XML 形式で返してくる場合の解析
  // <transcript><text start="0.12" dur="2.3">...</text>...</transcript>
  const cues = [];
  const re = /<text\s+start="([\d.]+)"\s+dur="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    const text = decodeEntities(m[3].replace(/<[^>]*>/g, ""))
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;
    const start = parseFloat(m[1]);
    const end = start + parseFloat(m[2]);
    cues.push({ start, end, text });
  }
  return cues;
}

function parseSrv3(raw) {
  // timedtext format="3" 形式: <timedtext><body><p t="200" d="1080">...</p>...
  // t/d はミリ秒。p の中に <s> の単語区切りが入ることもある。
  const cues = [];
  const re = /<p([^>]*)>([\s\S]*?)<\/p>/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    const t = /t="(\d+)"/.exec(m[1]);
    const d = /d="(\d+)"/.exec(m[1]);
    if (!t || !d) continue;
    const text = decodeEntities(m[2].replace(/<[^>]*>/g, ""))
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;
    const start = parseInt(t[1], 10) / 1000;
    const end = start + parseInt(d[1], 10) / 1000;
    cues.push({ start, end, text });
  }
  return cues;
}

function parseTimedtext(raw) {
  const trimmed = raw.trimStart();
  if (trimmed.startsWith("{")) return parseJson3(raw);
  if (trimmed.includes("<timedtext")) return parseSrv3(raw);
  if (trimmed.includes("<text")) return parseXmlTranscript(raw);
  return [];
}

function pickTrack(tracks, lang) {
  // 手動字幕を優先、なければ自動生成字幕(asr)
  const sameLang = tracks.filter((t) => (t.languageCode || "").startsWith(lang));
  return (
    sameLang.find((t) => t.kind !== "asr") ||
    sameLang.find((t) => t.kind === "asr") ||
    null
  );
}

async function fetchPlayerOnce(body) {
  const res = await fetch("https://www.youtube.com/youtubei/v1/player", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent":
        "com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("youtubei HTTP " + res.status);
  return res.json();
}

async function fetchPlayer(videoId) {
  // ANDROID -> WEB を試す。YouTube の応答はリクエストごとにブレる
  // (字幕トラックが付いたり付かなかったりする) ため、字幕トラック付きの
  // 応答が返るまで最大3ラウンド繰り返す。
  const attempts = [
    {
      context: { client: { clientName: "ANDROID", clientVersion: "20.10.38" } },
      videoId,
    },
    {
      context: {
        client: {
          clientName: "WEB",
          clientVersion: "2.20250101.00.00",
          hl: "en",
          gl: "US",
        },
      },
      videoId,
    },
  ];
  let firstWithDetails = null;
  for (let round = 0; round < 3; round++) {
    for (const body of attempts) {
      try {
        const data = await fetchPlayerOnce(body);
        if (!data || !data.videoDetails) continue;
        const tracks =
          data.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
        if (tracks.length) return data;
        if (!firstWithDetails) firstWithDetails = data;
      } catch (e) {
        // 次のクライアント / 次のラウンドへ
      }
    }
  }
  if (firstWithDetails) return firstWithDetails;
  throw new Error("youtubei returned no videoDetails");
}

async function fetchTrackCues(track, merge) {
  if (!track || !track.baseUrl) return [];
  const url = track.baseUrl + "&fmt=json3";
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip",
    },
  });
  if (!res.ok) throw new Error("timedtext HTTP " + res.status);
  const raw = await res.text();
  if (!raw) return [];
  const cues = parseTimedtext(raw);
  const isAuto = track.kind === "asr";
  return isAuto && merge ? mergeSentences(cues) : cues;
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }
    if (request.method !== "GET") {
      return jsonResponse(request, { error: "GET only" }, 405);
    }
    const url = new URL(request.url);
    const videoId = url.searchParams.get("v") || "";
    const merge = url.searchParams.get("merge") !== "0";
    const debug = url.searchParams.get("debug") === "1";
    if (!/^[\w-]{11}$/.test(videoId)) {
      return jsonResponse(request, { error: "video id を正しく指定してください" }, 400);
    }
    try {
      const player = await fetchPlayer(videoId);
      const title = player.videoDetails?.title || "";
      const tracks =
        player.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
      if (debug) {
        // デバッグ用: 字幕トラック一覧と、英語トラックの timedtext 生レスポンス先頭を返す
        const enTrack = pickTrack(tracks, "en");
        let sample = null;
        if (enTrack?.baseUrl) {
          try {
            const r = await fetch(enTrack.baseUrl + "&fmt=json3", {
              headers: {
                "User-Agent":
                  "com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip",
              },
            });
            const raw = await r.text();
            sample = {
              status: r.status,
              contentType: r.headers.get("content-type") || "",
              length: raw.length,
              head: raw.slice(0, 500),
            };
          } catch (e) {
            sample = { error: String(e.message || e) };
          }
        }
        return jsonResponse(request, {
          video_id: videoId,
          title,
          tracks: tracks.map((t) => ({
            languageCode: t.languageCode,
            kind: t.kind || "manual",
            name: t.name?.simpleText || "",
            baseUrl: t.baseUrl || "",
          })),
          timedtextSample: sample,
        });
      }
      const enTrack = pickTrack(tracks, "en");
      const jaTrack = pickTrack(tracks, "ja");
      if (!enTrack) {
        return jsonResponse(
          request,
          { error: "この動画から英語字幕が見つかりませんでした" },
          404
        );
      }
      const english = await fetchTrackCues(enTrack, merge);
      const japanese = jaTrack ? await fetchTrackCues(jaTrack, false) : [];
      if (!english.length) {
        return jsonResponse(
          request,
          { error: "英語字幕トラックはありましたが、字幕本文を取得できませんでした" },
          404
        );
      }
      return jsonResponse(request, {
        video_id: videoId,
        title,
        english,
        japanese,
        english_source: enTrack.kind === "asr" ? "自動生成字幕" : "手動字幕",
        japanese_source: jaTrack
          ? jaTrack.kind === "asr"
            ? "自動生成/翻訳字幕"
            : "手動字幕"
          : "日本語字幕なし",
      });
    } catch (e) {
      return jsonResponse(
        request,
        { error: "YouTube字幕の取得に失敗しました: " + String(e.message || e).slice(0, 200) },
        502
      );
    }
  },
};
