#!/usr/bin/env bash
# Sets up a fresh Ubuntu 24.04 VPS for GymLog, once, as root (#15). See docs/deploy.md:
#
#   ssh root@<server> 'bash -s' < deploy/setup-server.sh
#
# Safe to run again: each step skips what is already done. A server set up before #39 gets the
# app's database password and the SSH settings that way.
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
# tried in order before Docker Hub itself. Kept if already there, in case they were changed by hand.
mkdir -p /etc/docker
if [ ! -f /etc/docker/daemon.json ]; then
  cat > /etc/docker/daemon.json <<'EOF'
{
  "registry-mirrors": ["https://mirror.gcr.io", "https://dockerhub.timeweb.cloud"]
}
EOF
  # Docker reads it when it starts. Only a new file restarts it, since a restart stops the app
  # for a moment on a server that already runs it.
  systemctl restart docker
fi
systemctl enable --now docker

# The user deploys run as: it may run Docker, and signs in with root's SSH keys.
id deploy >/dev/null 2>&1 || adduser --disabled-password --gecos "" deploy
usermod -aG docker deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
install -m 600 -o deploy -g deploy /root/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys

# Where the Compose file, the Caddyfile and the .env live.
install -d -o deploy -g deploy /opt/gymlog
[ -f /opt/gymlog/.env ] || install -m 600 -o deploy -g deploy /dev/null /opt/gymlog/.env
# A line added below must not run on from one edited by hand without its line end.
[ -z "$(tail -c 1 /opt/gymlog/.env)" ] || echo >> /opt/gymlog/.env
# The database's passwords: the superuser's, and the app's own role's (#39). Each is made once
# and kept. Hex only, so they can stand in a database URL as they are.
for name in POSTGRES_PASSWORD APP_DATABASE_PASSWORD; do
  grep -q "^$name=" /opt/gymlog/.env || echo "$name=$(openssl rand -hex 24)" >> /opt/gymlog/.env
done

# Only SSH, HTTP and HTTPS (HTTP/3 too) are open.
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

# SSH takes keys only, so there is no password to guess (#39); root may still sign in, with a key.
# sshd keeps the first value it reads, so this file comes before 50-cloud-init.conf, which may
# turn passwords on.
cat > /etc/ssh/sshd_config.d/10-gymlog.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
EOF
# The settings as sshd would apply them to a sign-in as this user, Match blocks included.
# sshd -T may name prohibit-password by its older name, without-password.
ssh_settings() {
  sshd -T -C "user=$1,host=example.com,addr=203.0.113.1" |
    grep -E '^(passwordauthentication|kbdinteractiveauthentication|permitrootlogin) ' |
    sed 's/without-password/prohibit-password/' | sort
}
expected=$'kbdinteractiveauthentication no\npasswordauthentication no\npermitrootlogin prohibit-password'
# Checked before sshd reloads, so a mistake never goes live.
sshd -t || { rm /etc/ssh/sshd_config.d/10-gymlog.conf; exit 1; }
for user in root deploy; do
  effective=$(ssh_settings "$user")
  [ "$effective" = "$expected" ] || { echo "SSH would still let $user in without a key:"$'\n'"$effective" >&2; exit 1; }
done
systemctl reload ssh

echo "The server is ready; deploy with deploy/prod.sh deploy"
