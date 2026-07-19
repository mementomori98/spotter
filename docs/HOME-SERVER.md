# Hosting Spots on a home server

Free (minus electricity), your data stays home, and because the app is offline-first, brief
downtime never blocks you in the field — devices just sync later. Any always-on machine works:
old laptop, Mac mini, NAS with Docker, Raspberry Pi 4/5 (ARM is fine).

## 1. Get a free hostname (DuckDNS)

1. Sign in at https://www.duckdns.org (GitHub/Google login) and create a subdomain, e.g.
   `myspots.duckdns.org`. It shows your current public IP automatically.
2. Keep the IP updated (home IPs change). Easiest: add this to the server's crontab
   (`crontab -e`), with your token from the DuckDNS page:

   ```sh
   */5 * * * * curl -s "https://www.duckdns.org/update?domains=myspots&token=YOUR-TOKEN&ip=" >/dev/null
   ```

   Many routers and NAS boxes can also do DDNS natively — look for "DDNS" with a DuckDNS preset.

## 2. Forward ports on your router

In the router admin UI ("Port forwarding" / "NAT"):

- forward external **80 → 80** and **443 → 443** to your server's LAN IP
- give the server a fixed LAN IP ("DHCP reservation") so the rule doesn't break

Caddy needs port 80 reachable to obtain/renew Let's Encrypt certificates.

> If your ISP uses CGNAT (no public IPv4 — the IP on DuckDNS differs from the WAN IP in your
> router), port forwarding won't work. Use Tailscale on server + phone instead, or a cheap VPS.

## 3. Install and run

Install Docker (Linux: `curl -fsSL https://get.docker.com | sh`; macOS: Docker Desktop). Then:

```sh
git clone <your-copy-of-this-repo> spots && cd spots   # or copy the folder over
cp .env.example .env
# edit .env:  DOMAIN=myspots.duckdns.org   POSTGRES_PASSWORD=<something-random>
docker compose up -d --build
```

First start takes a minute (build + certificate). Then open `https://myspots.duckdns.org`,
create your account, and on your phone: Chrome → menu → **Add to Home screen**.

Everything restarts by itself: the containers are `restart: unless-stopped`, so a power cut or
reboot recovers on its own (make sure Docker itself starts on boot — default on Linux/systemd).

## 4. Updates & maintenance

```sh
docker compose up -d --build     # after changing the code
docker compose logs -f api       # watch the server
```

## 5. Backups

Everything lives in two Docker volumes: the database (`pgdata`) and photos (`photos`). Simple
nightly dump (add to crontab):

```sh
0 3 * * * cd /path/to/spots && docker compose exec -T postgres pg_dump -U spots spots | gzip > /backups/spots-db-$(date +\%u).sql.gz && docker run --rm -v spots_photos:/p -v /backups:/b alpine tar czf /b/spots-photos-$(date +\%u).tgz -C /p . 
```

(Keeps 7 rotating daily backups. Adjust paths; the photo volume name is `<folder>_photos`,
check with `docker volume ls`.) The app's own **Settings → Export backup (zip)** is an extra,
per-device safety net.

## Notes

- **Keep the URL private.** Registration is open to anyone who can reach the server (v1).
- RAM/CPU needs are tiny (~200 MB for API+DB idle). Disk grows with full-resolution photos —
  budget accordingly.
- Cert renewals are automatic (Caddy). No other maintenance is required.
