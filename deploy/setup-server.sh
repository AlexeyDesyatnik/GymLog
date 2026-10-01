#!/usr/bin/env bash
# Sets up a fresh Ubuntu 24.04 VPS for GymLog, once, as root (#15). See docs/deploy.md:
#
#   ssh root@<server> 'bash -s' < deploy/setup-server.sh
#
# Safe to run again: each step skips what is already done.
set -euo pipefail

# 1 GB of swap: a safety net for a 1 GB server, where nothing is built.
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 1G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# Docker from Ubuntu's own packages, whose mirrors are reachable from Russia.
apt-get update
apt-get install -y docker.io docker-compose-v2 ufw
# Docker Hub may be unreachable from Russia: the postgres and caddy images come through mirrors,
# tried in order before Docker Hub itself.
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<'EOF'
{
  "registry-mirrors": ["https://mirror.gcr.io", "https://dockerhub.timeweb.cloud"]
}
EOF
systemctl enable docker
systemctl restart docker

# The user deploys run as: it may run Docker, and signs in with root's SSH keys.
id deploy >/dev/null 2>&1 || adduser --disabled-password --gecos "" deploy
usermod -aG docker deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
install -m 600 -o deploy -g deploy /root/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys

# Where the Compose file, the Caddyfile and the .env live.
install -d -o deploy -g deploy /opt/gymlog
if [ ! -f /opt/gymlog/.env ]; then
  # Hex only, so it can stand in DATABASE_URL as it is.
  echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)" > /opt/gymlog/.env
  chown deploy:deploy /opt/gymlog/.env
  chmod 600 /opt/gymlog/.env
fi

# Only SSH, HTTP and HTTPS (HTTP/3 too) are open.
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

echo "The server is ready; deploy with deploy/prod.sh deploy"
