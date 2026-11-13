SpeakFlow English v3.6 - 字幕一覧がページを引っ張らない版（v3.5.2 ベース）

【v3.6の変更（今回）】
- 字幕一覧の自動スクロールが、ページ全体ではなく一覧の枠の中だけを
  動かすようになった。動画の再生に合わせて一覧は枠の中で追従するが、
  ページが下に引っ張られて映像が見えなくなることはない。
  一覧は枠の中で自分でスクロールもできる。
- 「この場面を保存」パネルに「いまの字幕：」の行を追加。動画の再生に
  合わせて今の字幕が常に表示される。入力欄は従来どおり、字幕タップか
  「今の字幕を入れる」で入れる（入力中の文字を勝手に書き換えない）。
- 変更は static/index.html とこの README.txt のみ。ほかのファイルは
  v3.5.2 と同じ。

SpeakFlow English v3.5 - YouTube字幕のCloudflare Workerフォールバック版（v3.4 ベース）

【v3.5の変更（今回）】
- 「字幕を自動取得」で、Renderのサーバーで取れない場合に Cloudflare Worker
  経由で自動的に試すようになった。Workerは YouTube の字幕API(youtubei)に
  Cloudflareの回線から聞きに行き、署名付き字幕URLから字幕本文を取る。
  json3 / 旧XML / srv3 の3形式に対応し、字幕付きの応答が来るまで最大3回試す。
- WorkerのURLは「使い方」タブの「字幕取得（Cloudflare Worker・予備）」で
  変更できる。未入力の場合は初期設定のWorker
  (https://speakflow-captions.inagaki80808080.workers.dev) を使う。
- Workerのコードは cloudflare-worker/worker.js に入っている。
  Cloudflareの無料アカウントで Worker を作り、このコードをデプロイして使う。
- 注意：Worker経由でも YouTube の応答が不安定なことがある（3回中1回ほど
  失敗することがあった）。失敗した場合は「字幕を自動取得」をもう一度押すと
  取れることがある。それでも取れない動画は、SRT/VTT読み込み・手入力を使う。
- 変更は static/index.html とこの README.txt と cloudflare-worker/worker.js
  の追加。ほかのファイルは v3.4 と同じ。

SpeakFlow English v3.4 - 学習画面その場で保存版（v3.3.1 ベース）

【v3.4の変更（今回）】
- 学習画面の動画のすぐ下に「この場面を保存」パネルを追加。動画を見ながら
  スクロールなしで登録できます。別の「＋ 登録」タブに移動しなくても保存できます。
- 使い方：字幕をタップすると英文が自動で入ります（単語をタップするとその単語が
  入ります）。「今の字幕を入れる」でも全文が入ります。「訳す」で日本語訳を
  自動入力（Geminiキー登録済みならGemini、なければMyMemoryの参考訳）。
  「＋ 保存」で保存。保存後、保存した表現からその場面に戻れます。
- 「＋ 登録」タブは残してあります。Netflixアプリで見た英文は、Netflixの動画が
  このアプリ内では再生できないため、引き続き「＋ 登録」から手入力で登録します。
- 変更は static/index.html とこの README.txt のみ。ほかのファイルは v3.3.1 と同じ。
- 注意：YouTube字幕の自動取得は、RenderのサーバーがYouTubeにブロックされる
  ため、取得できない動画があります（v3.3.1の修正でも改善しませんでした）。
  取得できない場合は、別の動画・SRT/VTT読み込み・手入力を使ってください。

SpeakFlow English v3.3.1 - YouTube字幕取得の修正版（v3.3 ベース）

【v3.3.1の変更（今回）】
- YouTube字幕の自動取得で「Sign in to confirm you're not a bot」エラーが出て
  取得できなかった問題の対策。app.py の yt-dlp 設定に
  extractor_args youtube player_client ["android","ios","web"] を追加し、
  WebプレイヤーではなくAndroid/iOSプレイヤーで取得を試すようにした。
  取得できない場合は次のクライアントにフォールバックする。
- 変更は app.py とこの README.txt のみ。ほかのファイルは v3.3 と同じ。
- 注意：ローカルでは修正版・旧版どちらも取得できたため、この修正が
  RenderのIPでのブロックを回避できるかは、Render上で実際に試すまで
  確定しない。Renderで試してダメな場合は、別の動画・SRT/VTT読み込み・
  「＋ 登録」の手入力を使ってください。

SpeakFlow English v3.3 - スマホ「＋登録」画面 追加版（v3.2 ベース）

【v3.3の変更（今回）】
- 下のタブに「＋ 登録」を追加。Netflixアプリで見た英文をスマホだけで手入力・音声入力して保存できます。
- 登録画面の入力：作品名（履歴からタップで選択）、シーズン・エピソード（任意）、再生時間（例：12:34 / 1:02:03）、英文（必須）、日本語訳（任意・あとから修正可）。
- 「翻訳・解説をつける」：Gemini APIキーを登録済みならGeminiで自然な訳＋ニュアンス・文法解説、未登録ならMyMemoryの参考訳を自動入力します。
- 保存すると「保存表現」に追加され、音声読み上げ・TSV出力・JSONバックアップ・PC同期の対象になります。保存形式はPC拡張と同じ（en/ja/context/title/t/source='netflix'）です。
- 学習画面に「＋ 字幕全文を保存」を追加。「フレーズ保存」は単語1つ、「字幕全文を保存」は今の字幕1文まるごと保存します。
- PWAアイコン（icon-192.png / icon-512.png）を追加し、manifestの start_url を ./ に変更。sw.js のキャッシュを v7 に更新。
- 変更は static/index.html / static/manifest.webmanifest / static/sw.js / static/icon-*.png のみ。app.py と Chrome拡張は v3.2 から変更していません。
- 使い方：Netflixで気になる英文を見たら、SpeakFlowの「＋ 登録」を開き、英文を入力（スマホのキーボードのマイク＝音声入力も可）→「翻訳・解説をつける」→「＋ この英文を保存」。

SpeakFlow English v3 - YouTube字幕自動取得版

【今回の主な変更】
- YouTube URLから動画を埋め込み再生
- サーバー側のyt-dlpを使い、YouTube字幕を自動取得
- 手動字幕と自動生成字幕の両方を検索
- 英語字幕・日本語字幕が利用可能な場合は両方取得
- 字幕と動画再生位置の同期、字幕クリックでシーク
- 字幕内の単語選択、Gemini APIによる日本語解説
- フレーズ保存、音声読み上げ、TSV出力、JSONバックアップ
- SRT/VTT手動読み込みも予備として残す

【v3.1 追加機能】
- 1文ループ再生（ループON＋「この字幕を再生」）、再生速度 0.5x/0.75x/1x
- 字幕表示切替（英+日 / 英語のみ / 聞き取り=ぼかし。タップで表示）
- フレーズ保存時に動画IDと時刻も保存。保存表現から「▶ 該当シーン」へジャンプ。TSVにも動画URL(?t=秒)を出力
- 単語タップでAPIキー不要の辞書表示（dictionaryapi.dev の英英辞書＋MyMemory の日本語参考訳）
- 自動字幕を文のまとまりに結合（チェックで切替）。日本語字幕は英語字幕の時間帯ごとにまとめて表示

【オンラインで使う手順（Render無料枠）】
1. このフォルダ一式をGitHubの新しいリポジトリにアップロード。
2. Renderで New > Web Service を選び、そのGitHubリポジトリを接続。
3. Runtime: Python、Build Command: pip install -r requirements.txt、Start Command: uvicorn app:app --host 0.0.0.0 --port $PORT。
   render.yamlを認識する場合は設定が自動入力されます。
4. FreeプランでDeploy。
5. 発行された https://....onrender.com をスマホで開き、Chromeメニューからホーム画面に追加。

【無料枠の注意】
- Render無料Web Serviceは15分アクセスがないとスリープし、次回アクセス時の起動に時間がかかります。
- 無料枠は試作・個人利用向けで、常時稼働保証はありません。
- 初回アクセス時はバックエンドの起動を待ってから字幕取得してください。

【字幕取得の制限】
- yt-dlpで公開YouTube動画の手動字幕・自動生成字幕を取得します。
- 全動画で取得できる保証はありません。字幕がない動画、年齢/地域/ログイン制限、YouTube側の仕様変更、アクセス制限などで失敗する場合があります。
- 字幕取得はYouTube公式APIではなくyt-dlpを利用します。利用にあたってYouTubeの規約・権利者の条件を守ってください。
- 日本語字幕が存在しない場合は英語のみになります。自動翻訳字幕はYouTube側が提供している場合のみ取得対象になります。

【ローカル実行】
Python 3.10以上を用意し、このフォルダで以下を実行:
  pip install -r requirements.txt
  uvicorn app:app --reload
その後 http://127.0.0.1:8000 を開く。

【AI解説】
Gemini APIキーはアプリ画面で任意登録します。キーはブラウザのlocalStorageに保存され、AI解説を押した単語と字幕文脈がGoogle APIに送信されます。API利用の無料枠・利用可否はGoogleの条件に従います。


【Netflix PC連携（試作 v0.1）】
- netflix_chrome_extension フォルダをChromeの拡張機能管理画面(chrome://extensions)で「デベロッパーモード」→「パッケージ化されていない拡張機能を読み込む」から読み込む。
- PCでSpeakFlowのWebサービスを開き、設定ページで同期URLと同期トークンを設定する。
- Chrome拡張機能のポップアップにも同じURL・トークンを設定する。
- NetflixをChromeで再生し英語字幕を表示。字幕文字をクリック、または字幕付近の「＋ SpeakFlowに保存」を押す。
- 保存した英文はサーバーに保存され、スマホのSpeakFlow設定ページで「今すぐ同期」を押すと取り込める。
- サーバーの環境変数 SPEAKFLOW_SYNC_TOKEN をPC拡張・スマホPWAで同じ値に設定する（推奨）。未設定時は同期APIにトークン認証がありません。
- 永続同期を無料で運用する場合はSupabase FreeのPostgreSQLを使う。Supabase SQL Editorで同梱の supabase_schema.sql を実行し、RenderのEnvironmentに SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY を設定する。Service Role Keyはサーバー側だけに保存し、Chrome拡張やスマホには入力しない。
- SPEAKFLOW_SYNC_TOKEN は別途任意の長いランダム文字列を設定し、PC拡張とスマホPWAにはこの値だけを入力する。
- Supabase環境変数が未設定ならSQLiteに保存する。Render Freeのローカルファイルは再起動・再デプロイで消える可能性があるため、SQLiteのままでは永続同期を保証できない。
- 現状はNetflixの画面DOMから字幕テキストを読む試作です。NetflixのUI変更・字幕描画方式・作品・ブラウザ環境により検出できない場合があります。Netflix公式の字幕APIではなく、DRM動画本体を取得するものでもありません。
- 拡張機能はChrome PC用です。Android版Chromeでは通常この拡張機能を実行できません。スマホはSpeakFlow PWAで同期済みの表現を学習します。
