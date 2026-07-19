# Deploying Spots on Azure (free tier)

One small Ubuntu VM runs everything (API + Postgres + Caddy via Docker Compose). The Azure free
account covers this 24/7 for the first 12 months (B1s / B2ats v2, 750 h/month); after that it's
~$8–10/mo — set a budget alert on day one.

## 1. Create the VM

1. https://portal.azure.com → **Create a resource → Virtual machine**
2. Basics:
   - Resource group: new, `spots`
   - VM name: `spots-vm`
   - Region: close to you (e.g. West Europe)
   - Image: **Ubuntu Server 24.04 LTS** (x64 for B1s; arm64 if you pick B2pts v2 — both work)
   - Size: **B1s** or **B2ats v2** — look for the "Eligible for free services" tag
   - Authentication: SSH public key → username `azureuser` → let it generate a key; **download
     the .pem** when prompted
   - Inbound ports: allow **SSH (22), HTTP (80), HTTPS (443)**
3. Disks/Networking/etc.: defaults are fine → **Review + create** → Create

## 2. Give it a hostname

VM → Overview → **DNS name: Configure** → set a label, e.g. `myspots` →
you now have `myspots.westeurope.cloudapp.azure.com` (free, survives IP changes — no DuckDNS
needed). This is your `DOMAIN`.

## 3. SSH in and prepare the box

```sh
chmod 600 ~/Downloads/spots-vm_key.pem
ssh -i ~/Downloads/spots-vm_key.pem azureuser@myspots.westeurope.cloudapp.azure.com
```

On the VM:

```sh
# Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER && exit
# (reconnect via ssh so the docker group takes effect)

# 2 GB swap — 1 GB RAM is enough to run Spots but tight for building it
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## 4. Get the code onto the VM

Either clone your GitHub repo:

```sh
git clone https://github.com/YOURUSER/spots.git && cd spots
```

or copy it from your Mac (no GitHub needed):

```sh
# on the Mac
rsync -a --exclude node_modules --exclude .svelte-kit --exclude build --exclude dist \
  -e "ssh -i ~/Downloads/spots-vm_key.pem" \
  ~/src/spots/ azureuser@myspots.westeurope.cloudapp.azure.com:~/spots/
```

## 5. Configure and launch

On the VM, in `~/spots`:

```sh
cp .env.example .env
nano .env    # DOMAIN=myspots.westeurope.cloudapp.azure.com
             # POSTGRES_PASSWORD=<something random>
docker compose up -d --build
```

First build takes a few minutes on a small VM. Watch it: `docker compose logs -f`.
When Caddy logs a certificate for your domain, open **https://myspots.westeurope.cloudapp.azure.com**,
create your account, and on Android: Chrome → menu → **Add to Home screen**.

## 6. Aftercare

- **Budget alert**: portal → Cost Management → Budgets → e.g. €5/month with an email alert, so
  the end of the free year can't surprise you.
- **Updates**: `cd ~/spots && git pull && docker compose up -d --build` (or re-rsync).
- **Backups**: the app's Settings → Export backup works from any device. Server-side, copy the
  Docker volumes occasionally (see docs/HOME-SERVER.md §5 — identical commands), or use Azure's
  VM backup.
- **Reboots**: containers are `restart: unless-stopped`; the VM auto-starts them after any
  restart. Nothing to do.
- Keep the URL private — registration is open (v1).

## Troubleshooting

- **Site unreachable**: check the VM's Networking tab — inbound rules for 80/443 must exist
  (they were created at step 1 if you ticked the ports).
- **Certificate errors in Caddy logs**: DNS label typo in `.env`, or port 80 rule missing.
- **Build killed / OOM**: swap not active (`free -h` should show 2 GB swap) — redo step 3.
