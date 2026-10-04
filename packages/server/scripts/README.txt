Shadowverse: Evolve NEXT  {{version}}  联机服务器 / online server

【中文】

这是什么
  App 联机界面里"使用服务器"用的服务器程序：玩家在服务器上按房间号见面，服务器只负责转发双方每一步的回答和聊天
  （两边的 App 各自运行同一局，服务器不运行游戏）。装在一台有公网 IP 的 Linux 服务器上（Ubuntu），一次装好以后自动运行。

安装（第一次）和更新（以后有新的包时）都是同样三步
  1. 腾讯云控制台 →"防火墙"：放行 TCP 22、80、443（80 给证书机构验证用，443 给玩家连接用）。
  2. 控制台 →"文件管理"：把 SVEN-server-{{version}}.tar.gz 上传到 /home/ubuntu。
  3. 控制台 →"登录"（网页终端），依次输入：
       tar xzf SVEN-server-{{version}}.tar.gz
       sudo bash SVEN-server-{{version}}/setup.sh 你的服务器公网IP
     它会装好 Node.js、申请免费证书（以后每几天自动续）、注册成系统服务（开机自动启动、崩溃自动重启），
     最后打印一段"客户端配置"文字。更新时原来的配置和密钥都保留；更新会断开正在进行的对局，最好在没人玩的时候做。

装好以后
  - 浏览器打开 https://你的IP/ ，显示"联机服务器正常运行"就对了。
  - 把打印出的那段文字放进工程根目录的 online-server.ini（打包电脑版、安卓版时会带上），
    或者在 App 的"设置 → 联机 → 修改服务器配置"里粘贴。

常用命令（在网页终端里）
  sudo sve-server status            现在谁在线、本小时每把密钥的用量
  sudo sve-server newkey 名字        新建一把密钥，打印它的客户端配置（几秒后生效）
  sudo sve-server client 名字        再打印一次某把密钥的客户端配置
  sudo sve-server keys              列出所有密钥
  sudo sve-server revoke 名字        作废一把密钥（用它的连接几秒内断开）
  sudo sve-server records           保存下来的对局有多少（双方都同意时存的，用来训练 AI；
                                    在"文件管理"里打开 /var/lib/sve-server/games/ 下载）
  sudo journalctl -u sve-server -n 100    看日志（每小时一行统计）
  sudo systemctl restart sve-server       重启
  配置文件：/etc/sve-server/server.ini（sudo nano 编辑：观战席、上限、保存对局、密钥；保存后几秒内生效）

【English】

What this is
  The server of the app's "use the server" online mode: players meet in rooms by code, and the server passes each player's
  answers and the chat to the other (both apps play the same game; the server doesn't run the game). It goes on a Linux
  server with a public IP (Ubuntu), and runs by itself once installed.

Installing (the first time) and updating (with a new package later): the same three steps
  1. Tencent Cloud console > Firewall: let TCP 22, 80 and 443 in (80: the certificate authority's check; 443: the players).
  2. Console > File management: upload SVEN-server-{{version}}.tar.gz to /home/ubuntu.
  3. Console > Log in (the web terminal), then:
       tar xzf SVEN-server-{{version}}.tar.gz
       sudo bash SVEN-server-{{version}}/setup.sh <the server's public IP>
     It installs Node.js, gets a free certificate (renewed every few days by itself), makes it a system service (starts
     with the server, restarts after a crash), and prints the "client config" text. An update keeps the configuration and
     the keys; it ends the games being played, so update when nobody plays.

Then
  - Open https://<IP>/ in a browser: it should say the server is OK.
  - Put the printed text in online-server.ini at the project's root (the PC and Android builds take it), or paste it in
    the app: Settings > Online > Edit the server configuration.

Commands (in the web terminal)
  sudo sve-server status            who is online, this hour's use of each key
  sudo sve-server newkey <name>     a new key, and its client config (works within seconds)
  sudo sve-server client <name>     a key's client config again
  sudo sve-server keys              the keys
  sudo sve-server revoke <name>     revoke a key (its connections close within seconds)
  sudo sve-server records           the games kept (when both players allow it, to train the AI; download them
                                    from /var/lib/sve-server/games/ with the console's file manager)
  sudo journalctl -u sve-server -n 100    the log (a line of numbers every hour)
  sudo systemctl restart sve-server       restart
  Configuration: /etc/sve-server/server.ini (sudo nano: spectator seats, limits, keeping games, keys; read again within seconds)
