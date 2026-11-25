#!/usr/bin/env bash
# Pasang bot sebagai layanan yang nyala terus dan hidup lagi sendiri setelah server restart.
# Dipakai di server Linux (Ubuntu / Debian), misalnya VM gratis Oracle Cloud.
# Cara: upload folder bot ke server, masuk ke foldernya, lalu jalankan:  bash deploy/linux-service.sh
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

if [ ! -f .env ]; then
  read -r -p "Tempel token bot lalu Enter: " TOKEN
  printf 'DISCORD_TOKEN=%s\n' "$TOKEN" > .env
  chmod 600 .env
fi

if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]; then
  echo "Memasang Node.js 22..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

echo "Memasang kebutuhan bot..."
npm install --omit=dev --no-audit --no-fund

UNIT=/etc/systemd/system/brv-panel-bot.service
sudo tee "$UNIT" >/dev/null <<UNITFILE
[Unit]
Description=BRV Panel Bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$(whoami)
WorkingDirectory=$DIR
EnvironmentFile=$DIR/.env
ExecStart=$(command -v node) index.js
Restart=always
RestartSec=5
TimeoutStopSec=20

[Install]
WantedBy=multi-user.target
UNITFILE

sudo systemctl daemon-reload
sudo systemctl enable --now brv-panel-bot
echo
echo "Selesai. Bot sudah nyala dan akan hidup lagi sendiri setelah server restart."
echo "Lihat log:   journalctl -u brv-panel-bot -f"
echo "Restart bot: sudo systemctl restart brv-panel-bot"
