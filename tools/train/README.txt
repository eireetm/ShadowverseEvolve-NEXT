Shadowverse: Evolve NEXT  {{version}}  训练数据包 / training kit

【中文】

这是什么
  帮 Shadowverse: Evolve NEXT 的 AI 生成训练用的对局。在你的电脑上让 AI 自己和自己对战，把下完的对局存进 training 文件夹，你把这个文件夹里的文件发给作者就好。
  不联网、不上传任何东西，也不记录任何个人信息（training\volunteer.txt 里只是一串随机字母，用来区分不同电脑的对局）。

需要
  Node.js 20 或更新（推荐 24 LTS）：https://nodejs.org/  国内镜像：https://npmmirror.com/mirrors/node/

怎么用
  1. 双击 start.bat。
  2. 窗口里会显示用了几个进程、每小时下了多少局。它只用大约一半的处理器线程，优先级较低，电脑可以照常使用（打游戏、看视频时可能会稍微卡一点，那时关掉就好）。
  3. 想停的时候直接关掉窗口。已经下完的对局都已经保存；正在下的那几局会丢掉，没关系。
  4. 下次再双击 start.bat 会接着下，存成新的文件。
  5. 把 training 文件夹里的 .jsonl.gz 文件发给作者（压缩打包、网盘都行）。

  想多用或少用几个进程：在这个文件夹里打开命令行，运行  node train.mjs --workers 4

注意
  - 只用这一个版本的训练包：作者换了新版本时会发新的训练包，旧的对局就用不上了。
  - 笔记本请插着电源用；电脑太热或太吵就关掉。

【English】

What this is
  It makes games for training the AI of Shadowverse: Evolve NEXT: the AI plays itself on your computer, and every finished
  game is saved in the training folder. Send the files in that folder to the author.
  Nothing goes online and nothing personal is written (training\volunteer.txt is only random letters that tell computers apart).

Needs
  Node.js 20 or newer (24 LTS recommended): https://nodejs.org/

How to use it
  1. Double-click start.bat.
  2. The window shows how many processes it uses and how many games an hour it makes. It uses about half of the processor
     threads at a lower priority, so the computer stays usable.
  3. Close the window to stop. Every finished game is saved; the few being played are dropped.
  4. Double-click start.bat again later to go on (into a new file).
  5. Send the .jsonl.gz files in the training folder to the author.

  More or fewer processes: in a command line in this folder,  node train.mjs --workers 4

Notes
  - Use only this version of the kit: a new version of the AI comes with a new kit, and older games can't be used with it.
  - Laptops: keep the power on. Stop it if the computer gets too hot or loud.
