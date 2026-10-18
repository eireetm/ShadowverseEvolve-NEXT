SVE NEXT  {{version}}
===============

中文 / 日本語 / English


【中文】

这是什么
  《Shadowverse: Evolve》（影之诗：进化对决）的非官方对战模拟器，仅供个人学习和测试用，不做商业用途，请于下载后24小时内删除。
  和官方（Cygames、Bushiroad）没有关系。不附带任何官方素材。

需要
  - Windows 10 / 11
  - Node.js 20 或更新的版本（推荐 24 LTS）：https://nodejs.org/
    国内下载慢时可以用镜像：https://npmmirror.com/mirrors/node/
  - 浏览器：Chrome 或 Edge

启动
  1. 解压到任意文件夹。
  2. 双击 start.bat：会打开一个黑色窗口，浏览器自动打开 http://127.0.0.1:5170/
  3. 玩的时候不要关黑色窗口，关掉它会退出。
  其他系统：在这个文件夹里运行  node server.mjs

能做的
  - 对战 AI：3种不同难度的Bot。
  - 构筑卡组、观看录像、设置（语言：English / 中文 / 日本語）。
  - 联机对战：双方都要用同一个版本（{{version}}）。一方"创建房间"，把房间号发给对方；连不上时用"手动连接"。

从旧版更新
  设置页最下面的"检查版本更新"：GitHub 上有新版本时会提示，点"更新"就自动下载、换掉程序并重启。
  只换程序（app、server.mjs、start.bat、README.txt、VERSION.txt、decks/samples）；你自己的卡组、录像、public 里的文件、
  settings.ini 和 online-server.ini 都不动。换下来的旧程序放在 update/previous 里。
  连不上 GitHub 时手动更新：把新版本里的 app 文件夹、server.mjs、start.bat、README.txt、VERSION.txt 复制到旧版的文件夹里，覆盖原来的。

文件夹
  decks/     卡组文件（samples/ 里是示例卡组）
  replays/   保存的录像
  public/    你自己的图片、声音、字体和卡牌文本，全部可选，放进去后刷新页面（见下面的"自定义资源"）
  settings.ini  设置：第一次启动时生成，可以直接编辑（游戏关着时改，或者改完后刷新页面），说明在文件里
  app/       程序本身，不要改动
  update/    更新时换下来的旧程序（update/previous），不需要可以删掉

遇到问题
  - 打开后一片黑、或者显示"界面出错了"：对这个页面关掉网页翻译和浏览器插件，再刷新。
  - 其他问题：对局画面右上角"显示侧边栏" → "调试" → "保存复现包"，把文件发给作者。

自定义资源
  游戏的外观和声音都可以用自己的文件替换或补充，不用改代码。

  查找顺序，先找到的优先：
    1. public/ 里你自己的文件；
    2. 内置的样子（纯色和文字）。声音没有内置的，没有文件就不响。

  规则：
    - 文件名（不含扩展名）要完全一致，区分大小写。
      - 图片可以是 png、jpg、jpeg、webp、gif、avif；
      - 声音可以是 mp3、ogg、wav、m4a；
      - 都按这个顺序找，同名的只用第一个。
    - 界面启动时读一次文件清单。放进新文件后刷新页面；图片有缓存时按 Ctrl+F5。
    - 按卡查找的资源，先找印刷编号（如 BP01-SL01，每个异画各有一个），再找卡牌定义编号（如 BP01-001）。
      给本体放一个文件，所有异画都会用它。
    - 编号里的 Ⓢ（如 BP03-LDⓈ01）在文件名里也可以写成普通的 S（BP03-LDS01.png）。

  图片（下面的路径都在 public/ 下，省略扩展名）
    images/cards/<编号>           卡图；双面卡的背面是 images/cards/<编号>_back
    images/cards/unknown          卡图缺失时的替代图（上面会写出卡名）
    images/backs/default          主卡组的卡背（牌堆、背面朝上的卡、对手的手牌）
    images/backs/evolve           进化牌组的卡背（没有时用主卡组的卡背）
    textures/board/field          一方的场地，对手的是同一张图旋转 180°。牌桌按原图（1586×992）上的格子摆卡，
                                  换图时要保持同样的尺寸和格子位置
    textures/menu/background_m    主界面的背景（设置、开局页也用）
    textures/menu/background_d    组卡界面的背景（没有时用主界面的）
    textures/menu/background_f    对局画面的背景
    textures/icons/<图标名>       卡牌文本里的图标（见下）
    图标名：fanfare、lastwords、act、evolve、engage、quick、q、ub、feed、ride、adv、cost00 … cost10、costX、attack、
    defense、forestcraft、swordcraft、runecraft、dragoncraft、abysscraft、havencraft。

  声音（音量在设置页调）
    audio/bgm/menu、audio/bgm/deck、audio/bgm/battle
                                        背景音乐：主界面、组卡界面、对局中。循环播放，换界面时淡入淡出
    audio/sfx/<名字>                    通用音效，名字见下表
    audio/cards/<编号>-p                这张卡被使用时（所有卡都可以有）
    audio/cards/<编号>-a                这只从者攻击时
    audio/cards/<编号>-d                这只从者被破坏时
    audio/cards/<主战者编号>-start      这位主战者的玩家的回合开始时（有它就不放 turn）
    audio/cards/<主战者编号>-greet、-thank、-apologize、-applaud、-shock、-confuse、-taunt
                                        这位主战者的玩家发快捷聊天时，依次是"你好。""谢谢你。""对不起……""真棒！"
                                        "怎么回事？""令人困惑……""我必将胜利！"

  通用音效（28 个）：
    draw                      抽牌
    search                    检索（搜寻）并公开、或从墓场加入手牌的卡在牌桌上展示时（对手的卡翻开，自己的卡抖动）
    spell、follower、amulet   使用法术、从者、护符（没有时用 play）
    play                      以上三种共用的后备
    activated                 使用起动能力（进化除外：进化放 evolve）
    attack                    从者攻击
    damage、leader-damage     从者、主战者受到伤害（主战者的没有时用 damage）
    destroy                   破坏
    evolve、super-evolve      进化、超进化（超进化的没有时用 evolve）
    heal                      回复
    buff                      获得攻击力、生命值
    target                    效果选择了卡
    token                     生成衍生物
    banish                    消失
    discard                   舍弃
    bounce                    回到手牌
    counter                   放置或取除指示物
    shuffle                   洗切牌堆
    turn                      回合开始
    quick                     快速提示弹出
    game-start                对局开始
    win、lose                 胜、负
    click                     界面点击

    - 一张卡有自己的音效时，就不放对应的通用音效：-p 代替 spell / follower / amulet，-a 代替 attack，-d 代替 destroy。
    - 进化后的从者，先找进化卡的编号，再找原来那张卡的编号。
    - 主战者的声音：所有人都听自己电脑上的这个文件。双职业时用对局里在前面的那张主战者（一般是主战者 1）。

  卡牌文本
    - text/<卡包>_<语言>.json（例如 text/BP22_cn.json；语言是 en、cn、ja）：卡牌的能力文本，可以直接改。
      程序本身不带卡牌文本，显示的都是这些文件里的。
    - 有这个文件时，这个卡包这种语言的文本全部用它的：文件里没有列出的卡就没有这种语言的文本（显示别的语言的）。
      别的卡包、别的语言不变。卡名不在这里（在程序里）。
    - 只影响显示：规则、Bot 和联机都不读卡牌文本，联机时每个人看到的是自己的。文件读不了时会提示。
    - 启动游戏时读取，放进新文件后刷新页面。繁体中文由 cn 的文本转换。

  字体和样式
    - fonts/<任意名>：字体文件，在 theme.css 里用 @font-face 引用。
    - theme.css：在内置样式之后加载，可以覆盖任何颜色、大小和字体。界面元素的类名都以 sve- 开头。例如：

      :root {
        --sve-ui-alpha: 0.88;       /* 面板、窗口、按钮的不透明度（1 为完全不透明） */
        --sve-area-alpha: 0.25;     /* 组卡界面的卡组区和卡池 */
        --sve-background-dim: 0.2;  /* 背景图压暗的程度（0 为不压暗） */
        --sve-accent: #f0b429;      /* 强调色 */
        --sve-card-base: 96px;      /* 牌桌以外的卡牌大小 */
        font-family: "My Font", sans-serif;
      }
      @font-face {
        font-family: "My Font";
        src: url("/fonts/MyFont.woff2") format("woff2");
      }


【日本語】

これは何か
  『Shadowverse: Evolve』の非公式対戦シミュレーターです。個人の学習・テスト用で、商用目的ではありません、ダウンロード後24時間以内に削除してください。
  公式（Cygames、ブシロード）とは関係ありません。カード画像や公式の画像素材は含まれていません。

必要なもの
  - Windows 10 / 11
  - Node.js 20 以降（24 LTS 推奨）：https://nodejs.org/
  - ブラウザ：Chrome または Edge

起動
  1. 好きなフォルダに展開します。
  2. start.bat をダブルクリック：黒いウィンドウが開き、ブラウザで http://127.0.0.1:5170/ が開きます。
  3. 遊んでいる間は黒いウィンドウを閉じないでください。閉じると終了します。
  他の OS：このフォルダで  node server.mjs  を実行します。

できること
  - AI と対戦：3種類のBotから選択可能。
  - デッキ構築、リプレイ、設定（言語：English / 中文 / 日本語）。
  - オンライン対戦：お互いに同じバージョン（{{version}}）が必要です。片方が「ルームを作る」でルームコードを相手に送ります。
    つながらないときは「手動で接続」を使ってください。

古いバージョンからの更新
  設定画面のいちばん下の「バージョンの更新を確認」：GitHub に新しいバージョンがあれば知らせます。「更新する」で自動的にダウンロードし、
  プログラムを入れ替えて再起動します。入れ替えるのはプログラム（app、server.mjs、start.bat、README.txt、VERSION.txt、decks/samples）だけで、
  自分のデッキ、リプレイ、public のファイル、settings.ini と online-server.ini はそのままです。古いプログラムは update/previous に残ります。
  GitHub に接続できないときは手動で：新しいバージョンの app フォルダ、server.mjs、start.bat、README.txt、VERSION.txt を
  古いバージョンのフォルダにコピーして上書きします。

フォルダ
  decks/     デッキファイル（samples/ はサンプルデッキ）
  replays/   保存したリプレイ
  public/    自分の画像・音声・フォント・カードテキスト（すべて任意。入れたらページを再読み込み。下の「カスタムリソース」を参照）
  settings.ini  設定：初回起動時に作られます。直接編集できます（ゲームを閉じているときに編集するか、編集後にページを再読み込み）。説明はファイルの中にあります
  app/       プログラム本体（変更しないでください）
  update/    更新で入れ替えた古いプログラム（update/previous）。不要なら削除してかまいません

困ったとき
  - 開いても真っ黒、または「画面でエラーが起きました」と出るとき：このページではページ翻訳とブラウザ拡張機能をオフにして、再読み込みしてください。
  - その他：対戦画面右上の「サイドバーを表示」→「デバッグ」→「不具合報告用に保存」で保存したファイルを作者に送ってください。

カスタムリソース
  ゲームの見た目と音は、自分のファイルで置き換えたり足したりできます。コードを変える必要はありません。

  探す順番（先に見つかったものを使います）：
    1. public/ に入れた自分のファイル
    2. 内蔵の見た目（単色と文字）。音は内蔵されていないので、ファイルがなければ鳴りません。

  ルール：
    - ファイル名（拡張子を除く）は、大文字・小文字まで完全に一致させてください。
      - 画像は png、jpg、jpeg、webp、gif、avif
      - 音声は mp3、ogg、wav、m4a
      - この順番で探し、同じ名前のものは最初の 1 つだけを使います。
    - ファイルの一覧は画面の起動時に 1 回読みます。ファイルを入れたらページを再読み込みしてください
      （画像がキャッシュされているときは Ctrl+F5）。
    - カードごとのリソースは、まず印刷バージョンの番号（BP01-SL01 など。イラスト違いごとに 1 つ）、次にカード定義の番号
      （BP01-001 など）で探します。元のカードに 1 つ置けば、すべてのイラスト違いに使われます。
    - 番号の Ⓢ（BP03-LDⓈ01 など）は、ファイル名では普通の S でもかまいません（BP03-LDS01.png）。

  画像（パスはすべて public/ の下。拡張子は省略）
    images/cards/<番号>           カード画像。両面カードの裏面は images/cards/<番号>_back
    images/cards/unknown          カード画像がないときに代わりに表示する画像（カード名が書かれます）
    images/backs/default          メインデッキのカードの裏面（デッキ、裏向きのカード、相手の手札）
    images/backs/evolve           エボルヴデッキのカードの裏面（ないときはメインデッキの裏面）
    textures/board/field          自分側のプレイマット。相手側は同じ画像を 180° 回したもの。カードは元の画像（1586×992）
                                  に描かれた枠に置かれるので、差し替える画像も同じ大きさ・同じ枠の位置にしてください
    textures/menu/background_m    メニューの背景（設定、対戦の準備画面でも使います）
    textures/menu/background_d    デッキ構築の背景（ないときはメニューの背景）
    textures/menu/background_f    対戦画面の背景
    textures/icons/<アイコン名>   カードテキストのアイコン（下を参照）
    アイコン名：fanfare、lastwords、act、evolve、engage、quick、q、ub、feed、ride、adv、cost00 … cost10、costX、attack、
    defense、forestcraft、swordcraft、runecraft、dragoncraft、abysscraft、havencraft

  音声（音量は設定画面で調整）
    audio/bgm/menu、audio/bgm/deck、audio/bgm/battle
                                        BGM：メニュー、デッキ構築、対戦中。ループ再生し、
                                        画面が変わるときはフェードします
    audio/sfx/<名前>                    共通の効果音（名前は下の表）
    audio/cards/<番号>-p                このカードをプレイしたとき（どのカードにも置けます）
    audio/cards/<番号>-a                このフォロワーが攻撃したとき
    audio/cards/<番号>-d                このフォロワーが破壊されたとき
    audio/cards/<リーダーの番号>-start  このリーダーのプレイヤーのターンが始まったとき（これがあれば turn は鳴りません）
    audio/cards/<リーダーの番号>-greet、-thank、-apologize、-applaud、-shock、-confuse、-taunt
                                        このリーダーのプレイヤーがクイックチャットを送ったとき。順に「こんにちは。」
                                        「ありがとう。」「ごめんなさい……」「すごい！」「どういうこと？」「困ったな……」
                                        「勝つのは私だ！」

  共通の効果音（28 個）：
    draw                      カードを引く
    search                    サーチして公開したカードや、墓場から手札に加えたカードを盤面に見せるとき
                              （相手のカードは表向きになり、自分のカードは揺れます）
    spell、follower、amulet   スペル、フォロワー、アミュレットのプレイ（ないときは play）
    play                      上の 3 つに共通の代わり
    activated                 起動能力のプレイ（進化は除く：進化は evolve）
    attack                    フォロワーの攻撃
    damage、leader-damage     フォロワー、リーダーがダメージを受ける（リーダーのものがないときは damage）
    destroy                   破壊
    evolve、super-evolve      進化、超進化（超進化のものがないときは evolve）
    heal                      回復
    buff                      攻撃力・体力を得る
    target                    効果がカードを選ぶ
    token                     トークンを出す
    banish                    消滅
    discard                   捨てる
    bounce                    手札に戻る
    counter                   カウンターを置く・取り除く
    shuffle                   デッキをシャッフル
    turn                      ターン開始
    quick                     クイックの案内が出る
    game-start                対戦開始
    win、lose                 勝ち、負け
    click                     画面をクリック

    - カード自身の効果音があるときは、対応する共通の効果音は鳴りません：-p は spell / follower / amulet、-a は attack、
      -d は destroy の代わりです。
    - 進化したフォロワーは、まず進化カードの番号、次に元のカードの番号で探します。
    - リーダーの声：全員が自分のパソコンにあるそのファイルを聞きます。クロスクラフトでは、対戦で前にいるリーダー
      （普通はリーダー 1）のものです。

  カードテキスト
    - text/<セット>_<言語>.json（例：text/BP22_cn.json。言語は en・cn・ja）：カードの能力テキスト。直接編集できます。
      プログラム自体はカードテキストを持たず、これらのファイルのものを表示します。
    - このファイルがあると、そのセットのその言語のテキストはすべてこのファイルのものになります。
      ファイルにないカードはその言語のテキストがありません（ほかの言語のものを表示）。ほかのセット、
      ほかの言語は変わりません。カード名はここにはありません（プログラムに入っています）。
    - 表示だけに使います：ルール、Bot、オンライン対戦はカードテキストを読みません。
      オンライン対戦では各自が自分のものを見ます。読めないファイルがあると知らせます。
    - ゲームの起動時に読みます。ファイルを入れたらページを再読み込みしてください。
      繁体字中国語は cn のテキストから変換します。

  フォントとスタイル
    - fonts/<好きな名前>：フォントファイル。theme.css の @font-face で使います。
    - theme.css：内蔵のスタイルのあとに読み込まれ、どの色・大きさ・フォントも上書きできます。
      画面の要素のクラス名はすべて sve- で始まります。例：

      :root {
        --sve-ui-alpha: 0.88;       /* パネル、ウィンドウ、ボタンの不透明度（1 で完全に不透明） */
        --sve-area-alpha: 0.25;     /* デッキ構築画面のデッキとカードプール */
        --sve-background-dim: 0.2;  /* 背景画像を暗くする度合い（0 で暗くしない） */
        --sve-accent: #f0b429;      /* アクセントカラー */
        --sve-card-base: 96px;      /* 盤面以外でのカードの大きさ */
        font-family: "My Font", sans-serif;
      }
      @font-face {
        font-family: "My Font";
        src: url("/fonts/MyFont.woff2") format("woff2");
      }


【English】

What this is
  An unofficial simulator of the card game Shadowverse: Evolve, for personal study and testing, not for commercial use, please delete within 24 hours of downloading.
  Not affiliated with Cygames or Bushiroad. No card images or official picture assets are included.

You need
  - Windows 10 / 11
  - Node.js 20 or newer (24 LTS recommended): https://nodejs.org/
  - Chrome or Edge

Start
  1. Unzip it anywhere.
  2. Double-click start.bat: a black window opens, and the browser opens http://127.0.0.1:5170/
  3. Keep the black window open while playing; closing it quits.
  Other systems: run  node server.mjs  in this folder.

What it does
  - Play against the AI: 3 Bots with different difficulty.
  - Build decks, watch replays, settings (language: English / 中文 / 日本語).
  - Online play: both players need the same version ({{version}}). One makes a room and sends the room code;
    if it can't connect, use "Connect by hand".

Updating from an older version
  "Check for updates" at the bottom of the settings: when GitHub has a newer version, "Update" downloads it, puts the new
  program in place and restarts. Only the program is replaced (app, server.mjs, start.bat, README.txt, VERSION.txt,
  decks/samples): your decks, replays, files in public, settings.ini and online-server.ini stay as they are. The old program
  is kept in update/previous.
  When GitHub can't be reached, by hand: copy the new version's app folder, server.mjs, start.bat, README.txt and VERSION.txt
  into the old version's folder, replacing theirs.

Folders
  decks/     deck files (samples/: sample decks)
  replays/   saved replays
  public/    your own images, sounds, fonts and card texts, all optional; reload the page after adding files
             (see "Custom resources" below)
  settings.ini  the settings: made at the first start, and can be edited by hand (while the game is closed, or reload the page
             after saving it); the comments in it explain each one
  app/       the program itself; don't change it
  update/    the program an update replaced (update/previous); delete it if you like

Problems
  - A black page, or "The interface stopped working": turn off page translation and browser extensions for this page, then reload.
  - Anything else: in a game, "Show sidebar" (top right) → "Debug" → "Save a bug report file", and send the file to the author.

Custom resources
  The game's look and sound can be replaced or extended with your own files, with no code change.

  Where things are looked for, first found wins:
    1. Your own files in public/.
    2. The built-in look (plain colors and text). There are no built-in sounds: without a file, nothing plays.

  Rules:
    - The file name without its extension must match exactly, case included.
      - Pictures can be png, jpg, jpeg, webp, gif or avif.
      - Sounds can be mp3, ogg, wav or m4a.
      - They are tried in that order, and only the first match is used.
    - The interface reads the list of files once when it starts. After adding files, reload the page, with Ctrl+F5 if
      pictures are cached.
    - Per-card resources are looked up by printing number first (e.g. BP01-SL01; each alternate art has its own), then
      by card definition number (e.g. BP01-001). One file for the base card serves all its alternate arts.
    - A Ⓢ in a number (e.g. BP03-LDⓈ01) may also be a plain S in the file name (BP03-LDS01.png).

  Pictures (paths under public/, extension left out)
    images/cards/<number>         A card image; the back of a double-faced card is images/cards/<number>_back
    images/cards/unknown          Shown when a card image is missing (with the card name written on it)
    images/backs/default          The main deck's card back (the deck, face-down cards, the opponent's hand)
    images/backs/evolve           The evolve deck's card back (the main deck's back when missing)
    textures/board/field          One side's playmat; the opponent's is the same picture turned 180°. Cards sit on the
                                  slots drawn on the original (1586×992), so a new picture must keep that size and those
                                  slots
    textures/menu/background_m    The main menu's background (also settings and game setup)
    textures/menu/background_d    The deck builder's background (the main menu's when missing)
    textures/menu/background_f    The game screen's background
    textures/icons/<icon>         Icons in card text (see below)
    Icon names: fanfare, lastwords, act, evolve, engage, quick, q, ub, feed, ride, adv, cost00 … cost10, costX, attack,
    defense, forestcraft, swordcraft, runecraft, dragoncraft, abysscraft, havencraft.

  Sounds (volume in the settings)
    audio/bgm/menu, audio/bgm/deck, audio/bgm/battle
                                        Music: main menu, deck builder, in a game. Loops, and fades between screens
    audio/sfx/<name>                    Sound effects, names below
    audio/cards/<number>-p              When this card is played (any card)
    audio/cards/<number>-a              When this follower attacks
    audio/cards/<number>-d              When this follower is destroyed
    audio/cards/<leader number>-start   When this leader's player's turn starts (instead of turn)
    audio/cards/<leader number>-greet, -thank, -apologize, -applaud, -shock, -confuse, -taunt
                                        When this leader's player sends a quick chat line: "Hello.", "Thank you.",
                                        "Sorry...", "Awesome!", "What's going on?", "How puzzling...", "Victory will be
                                        mine!" in that order

  Sound effects (28):
    draw                      Drawing
    search                    A card searched and revealed, or taken from a cemetery, is shown on the table as it goes
                              into the hand (the opponent's turns face up, yours shakes)
    spell, follower, amulet   Playing a spell, follower or amulet (play when missing)
    play                      The fallback for those three
    activated                 Playing an activated ability (not Evolve: that plays evolve)
    attack                    A follower attacks
    damage, leader-damage     A follower or a leader takes damage (damage when the leader's is missing)
    destroy                   A card is destroyed
    evolve, super-evolve      Evolving, super-evolving (evolve when the latter is missing)
    heal                      Healing
    buff                      Gaining attack or defense
    target                    An effect selects a card
    token                     A token is created
    banish                    Banishing
    discard                   Discarding
    bounce                    Returning to the hand
    counter                   Putting or removing counters
    shuffle                   Shuffling the deck
    turn                      A turn starts
    quick                     The Quick announcement appears
    game-start                The game starts
    win, lose                 Winning, losing
    click                     Clicking in the interface

    - A card's own sound replaces the matching effect: -p replaces spell / follower / amulet, -a replaces attack, -d
      replaces destroy.
    - An evolved follower looks for its evolved card's number first, then the original card's.
    - A leader's voices: everyone hears their own file for that leader. In Cross Craft, the leader in front in the game
      (usually leader 1).

  Card texts
    - text/<set>_<language>.json (such as text/BP22_cn.json; the languages are en, cn, ja): the cards' ability texts,
      which you can edit. The program has no card texts of its own: it shows those of these files.
    - With such a file, that set's texts in that language all come from it: a card it doesn't list has no text in that
      language (another language's shows). Other sets and languages stay as they are. Card names aren't in it (they are
      in the program).
    - Only what is shown: the rules, the bots and online play never read card texts, and in an online game each player
      sees their own. A file that can't be read is told.
    - They are read when the game starts: reload the page after adding files. Traditional Chinese is converted from the
      cn texts.

  Fonts and style
    - fonts/<any name>: font files, referenced from theme.css with @font-face.
    - theme.css: loaded after the built-in style, so it can override any color, size or font. Every element of the
      interface has a class starting with sve-. For example:

      :root {
        --sve-ui-alpha: 0.88;       /* opacity of panels, windows, buttons (1 = opaque) */
        --sve-area-alpha: 0.25;     /* the deck builder's card areas */
        --sve-background-dim: 0.2;  /* how much the background pictures are darkened (0 = not at all) */
        --sve-accent: #f0b429;      /* accent color */
        --sve-card-base: 96px;      /* card size outside the table */
        font-family: "My Font", sans-serif;
      }
      @font-face {
        font-family: "My Font";
        src: url("/fonts/MyFont.woff2") format("woff2");
      }
