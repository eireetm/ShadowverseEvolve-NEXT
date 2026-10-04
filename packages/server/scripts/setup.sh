#!/usr/bin/env bash
# Shadowverse: Evolve NEXT — the online server: install it, or update it (run it again with a new package).
#   sudo bash setup.sh <the server's public IP>
# What it does: Node.js (from a mirror in China), the program in /opt/sve-server, its configuration in /etc/sve-server
# (kept when it exists: the keys stay), a free certificate for the IP from Let's Encrypt (certbot; it renews itself every few
# days), and a system service that starts with the server and restarts after a crash. Then it prints the text an app needs.
# 安装或更新联机服务器：sudo bash setup.sh <服务器的公网 IP>
set -euo pipefail

say() { printf '\n== %s\n' "$*"; }
die() { printf '\n!! %s\n' "$*" >&2; exit 1; }

IP="${1:-}"
[ "$(id -u)" -eq 0 ] || die "请用 sudo 运行 / run it with sudo: sudo bash setup.sh <IP>"
[[ "$IP" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || die "用法 usage: sudo bash setup.sh <服务器的公网 IPv4 地址 the server's public IPv4 address>"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -f "$HERE/server.mjs" ] || die "找不到 server.mjs（请在解压出的文件夹里运行） server.mjs is missing: run it in the unpacked folder"

NODE_DIR=/opt/sve-node
NODE="$NODE_DIR/bin/node"
CONF_DIR=/etc/sve-server
CONF="$CONF_DIR/server.ini"

# ---- 1. Node.js 24 (npmmirror.com: reachable in China), unless it is there already ----
if "$NODE" -v 2>/dev/null | grep -Eq '^v(2[4-9]|[3-9][0-9])\.'; then
  say "Node.js $("$NODE" -v) 已安装 installed"
else
  say "安装 Node.js installing Node.js"
  case "$(uname -m)" in
    x86_64) ARCH=x64 ;;
    aarch64) ARCH=arm64 ;;
    *) die "不支持的 CPU unsupported CPU: $(uname -m)" ;;
  esac
  BASE=https://npmmirror.com/mirrors/node/latest-v24.x
  SUMS="$(curl -fsSL "$BASE/SHASUMS256.txt")" || die "下载失败 download failed: $BASE/SHASUMS256.txt"
  LINE="$(printf '%s\n' "$SUMS" | grep -E " node-v[0-9.]+-linux-$ARCH\.tar\.xz$" | head -n 1)"
  [ -n "$LINE" ] || die "镜像上找不到 Node.js not found on the mirror"
  FILE="${LINE##* }"
  curl -fSL --retry 3 -o /tmp/sve-node.tar.xz "$BASE/$FILE" || die "下载失败 download failed: $BASE/$FILE"
  printf '%s  /tmp/sve-node.tar.xz\n' "${LINE%% *}" | sha256sum -c --quiet - || die "Node.js 下载不完整 the download is damaged"
  rm -rf "$NODE_DIR"
  mkdir -p "$NODE_DIR"
  tar -xJf /tmp/sve-node.tar.xz -C "$NODE_DIR" --strip-components=1
  rm -f /tmp/sve-node.tar.xz
  say "Node.js $("$NODE" -v)"
fi

# ---- 2. The program, its user, the sve-server command ----
say "安装程序 installing the program"
id sve >/dev/null 2>&1 || useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin sve
install -d -m 755 /opt/sve-server
install -m 644 "$HERE/server.mjs" /opt/sve-server/server.mjs
cat > /usr/local/bin/sve-server <<EOF
#!/bin/sh
# Shadowverse: Evolve NEXT online server (sve-server help)
exec $NODE /opt/sve-server/server.mjs "\$@"
EOF
chmod 755 /usr/local/bin/sve-server

# ---- 3. The configuration (a new one with a first key; an existing one is kept) ----
install -d -m 750 -o root -g sve "$CONF_DIR"
sve-server init "wss://$IP" --config "$CONF"
chown root:sve "$CONF"
chmod 640 "$CONF"

# ---- 4. The certificate: Let's Encrypt, for the IP address (6 days, renewed every few days by certbot's timer) ----
say "证书 the certificate"
if ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
fi
CERTBOT=/snap/bin/certbot
if [ ! -x "$CERTBOT" ]; then
  say "安装 certbot installing certbot (snap)"
  command -v snap >/dev/null 2>&1 || { apt-get update -q && apt-get install -y -q snapd; }
  snap install --classic certbot || die "certbot 安装失败 certbot couldn't be installed"
fi
install -d -m 755 /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/sve-server.sh <<EOF
#!/bin/sh
# A renewed certificate where the online server (user sve) reads it; the server takes it within a minute.
set -e
[ "\$(basename "\$RENEWED_LINEAGE")" = sve-server ] || exit 0
install -d -m 750 -o root -g sve $CONF_DIR/tls
install -m 640 -o root -g sve "\$RENEWED_LINEAGE/fullchain.pem" $CONF_DIR/tls/fullchain.pem
install -m 640 -o root -g sve "\$RENEWED_LINEAGE/privkey.pem" $CONF_DIR/tls/privkey.pem
EOF
chmod 755 /etc/letsencrypt/renewal-hooks/deploy/sve-server.sh
# certbot answers Let's Encrypt's check on port 80 itself, for a moment (nothing else uses that port), now and at each renewal.
"$CERTBOT" certonly --standalone --non-interactive --agree-tos --register-unsafely-without-email \
  --preferred-profile shortlived --ip-address "$IP" --cert-name sve-server --keep-until-expiring \
  || die "证书申请失败：请确认腾讯云控制台的防火墙放行了 TCP 80 和 443，然后再运行一次。
the certificate couldn't be had: check that the firewall (Tencent Cloud console) lets TCP 80 and 443 in, then run this again."
RENEWED_LINEAGE=/etc/letsencrypt/live/sve-server sh /etc/letsencrypt/renewal-hooks/deploy/sve-server.sh

# ---- 5. The service ----
say "系统服务 the service"
cat > /etc/systemd/system/sve-server.service <<EOF
[Unit]
Description=Shadowverse: Evolve NEXT online server
After=network-online.target
Wants=network-online.target

[Service]
User=sve
Group=sve
ExecStart=$NODE /opt/sve-server/server.mjs --config $CONF
ExecReload=/bin/kill -HUP \$MAINPID
Restart=always
RestartSec=3
# Port 443 without being root; nothing written anywhere (it logs to the journal).
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable sve-server >/dev/null 2>&1
systemctl restart sve-server
sleep 2
systemctl is-active --quiet sve-server || { journalctl -u sve-server -n 30 --no-pager; die "服务没有启动 the service didn't start (journalctl -u sve-server)"; }
curl -fsSk --max-time 5 https://127.0.0.1/ >/dev/null || die "服务器没有回应 the server doesn't answer (journalctl -u sve-server)"

say "完成 done. 在浏览器里打开 open in a browser: https://$IP/ （应该显示\"联机服务器正常运行\" it should say the server is OK）"
echo
echo "把下面这段文字放进工程里的 online-server.ini，或者在 App 的 设置 → 修改服务器配置 里粘贴："
echo "Put this text in the project's online-server.ini, or paste it in the app's settings (online server):"
echo
sve-server client first --config "$CONF" 2>/dev/null || sve-server keys --config "$CONF"
echo
echo "以后 later:  sudo sve-server status（谁在线 who is online） · sudo sve-server newkey <名字>（新密钥 a new key） · sudo sve-server revoke <名字>（作废 revoke）"
echo "日志 log:    sudo journalctl -u sve-server -n 100"
