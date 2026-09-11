#!/usr/bin/env bash
# Initial Ubuntu host setup only; ordinary releases never run package/proxy setup.
set -euo pipefail
[[ $(id -u) == 0 ]]
getent passwd ubuntu >/dev/null
chown ubuntu:ubuntu /home/ubuntu
install -d -o ubuntu -g ubuntu /home/ubuntu/.kamal /home/ubuntu/.kamal/proxy /home/ubuntu/.kamal/proxy/apps-config
install -d /etc/docker
printf '%s\n' '{"log-driver":"json-file","log-opts":{"max-size":"10m","max-file":"3"}}' > /etc/docker/daemon.json
# Same signed Ubuntu packages; avoid the regional mirror that returned HTTP503.
if [[ -f /etc/apt/sources.list.d/ubuntu.sources ]]; then
  sed -i 's@http://ap-southeast-1.ec2.archive.ubuntu.com/ubuntu@http://archive.ubuntu.com/ubuntu@g' /etc/apt/sources.list.d/ubuntu.sources
fi
apt-get -o Acquire::Retries=3 update
DEBIAN_FRONTEND=noninteractive apt-get -o Acquire::Retries=3 install -y docker.io curl
usermod -aG docker ubuntu
systemctl enable --now docker
systemctl restart docker
docker network inspect kamal >/dev/null 2>&1 || docker network create kamal
image=basecamp/kamal-proxy:v0.9.2
pinned=basecamp/kamal-proxy@sha256:826a6f66c6ba26ac26197ac8755804403c9bb617b90cfac25c7972154c5328ab
docker pull "$pinned"
docker tag "$pinned" "$image"
printf '%s\n' v0.9.2 > /home/ubuntu/.kamal/proxy/image_version
chown ubuntu:ubuntu /home/ubuntu/.kamal/proxy/image_version
docker run -d --name kamal-proxy --network kamal --restart unless-stopped \
  --log-opt max-size=10m --log-opt max-file=3 -p 80:80 \
  -v kamal-proxy-config:/home/kamal-proxy/.config/kamal-proxy \
  -v /home/ubuntu/.kamal/proxy/apps-config:/home/kamal-proxy/.apps-config "$image"
[[ $(docker inspect --format '{{.State.Running}}' kamal-proxy) == true ]]
runuser -u ubuntu -- test -w /home/ubuntu/.kamal/proxy
printf '%s\n' MANGMEE_KAMAL_BOOTSTRAP_V2_COMPLETE
