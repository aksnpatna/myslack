# MySlack — Network & Deployment Reference

## Architecture Overview

```
Mobile/Browser
     │  HTTPS / WSS
     ▼
Cloudflare Edge (DNS Proxy)
     │  HTTP (tunnel, no open ports)
     ▼
cloudflared tunnel  ←── asx-cloudflared Docker container
     │                  config: /home/aksai/projects/asx-prediction/cloudflared-config.yml
     ├── slack.akstest.win        → localhost:19006  (Expo Metro dev server)
     ├── slack-api.akstest.win   → localhost:3000   (Fastify backend)
     └── huddle.akstest.win      → localhost:7880   (LiveKit signal server)
```

---

## Cloudflare Tunnel Routes

File: `/home/aksai/projects/asx-prediction/cloudflared-config.yml`

| Public Hostname           | Internal Target                    | Service        |
|---------------------------|------------------------------------|----------------|
| `slack.akstest.win`       | `http://host.docker.internal:19006`| Expo frontend  |
| `slack-api.akstest.win`   | `http://host.docker.internal:3000` | Fastify API    |
| `huddle.akstest.win`      | `http://host.docker.internal:7880` | LiveKit signal |

**To add a new route:** add an entry above the final `- service: http_status:404` line, then restart the container:
```bash
docker restart asx-cloudflared
```

---

## Local Services

### Backend (Fastify)
| Property       | Value                                          |
|----------------|------------------------------------------------|
| Port           | 3000                                           |
| Start command  | `npm start` (inside `server/`)                 |
| Env file       | `/home/aksai/projects/myslack/.env`            |
| Systemd unit   | `myslack-backend.service`                      |
| Logs           | `journalctl --user -u myslack-backend -f`      |

### Frontend (Expo Metro)
| Property       | Value                                          |
|----------------|------------------------------------------------|
| Port           | 19006                                          |
| Start command  | `npm run web` (inside project root)            |
| Env file       | `/home/aksai/projects/myslack/.env`            |
| Systemd unit   | `myslack-frontend.service`                     |
| Logs           | `journalctl --user -u myslack-frontend -f`     |

> **Important:** `EXPO_PUBLIC_*` variables are baked into the JS bundle by Metro at bundle time.
> After changing any `EXPO_PUBLIC_*` value in `.env`, you **must** restart the frontend service:
> ```bash
> systemctl --user restart myslack-frontend.service
> ```

---

## Environment Variables (`.env`)

```
EXPO_PUBLIC_API_URL=https://slack-api.akstest.win   # HTTP API base — must be HTTPS
EXPO_PUBLIC_WS_URL=wss://slack-api.akstest.win      # WebSocket base — must be WSS
```

**Rules:**
- These must always point to the public Cloudflare hostname, never `localhost`
- The fallback values in each client file also reflect these (updated in source)
- Changing these requires a Metro restart (see above)

---

## Client-Side URL Fallbacks

Each of these files declares its own fallback. If `EXPO_PUBLIC_API_URL` is unset, these are used:

| File                                    | Fallback API URL                    |
|-----------------------------------------|-------------------------------------|
| `client/App.js`                         | `https://slack-api.akstest.win`     |
| `client/src/screens/LoginScreen.js`     | `https://slack-api.akstest.win`     |
| `client/src/screens/MainWorkspace.js`   | `https://slack-api.akstest.win`     |
| `client/src/screens/HuddleWorkspace.js` | `https://slack-api.akstest.win`     |
| `client/src/screens/MainWorkspace.js`   | `wss://slack-api.akstest.win/ws/chat` (WS_URL) |

---

## CORS Configuration

File: `server/src/app.js`

Allowed origin: `https://slack.akstest.win`

If you add another frontend domain (e.g. a mobile app scheme or a staging domain), add it to the CORS origin list in `app.js`.

---

## LLM Routing

| Provider | Trigger                  | Endpoint                              |
|----------|--------------------------|---------------------------------------|
| Groq     | Primary (always tried first) | `https://api.groq.com/openai/v1`  |
| Ollama   | Groq fails / key absent  | `http://192.168.1.150:11434/v1`       |

Ollama is queued via `LocalLlmQueue` in `server/src/utils/executiveAgent.js` — only one request runs at a time to protect the Mac M1 (8GB).

Model: `phi4-mini-16k:latest` (16K context window, hosted on Mac M1 at 192.168.1.150)

---

## Systemd Auto-Start

Services are enabled as user-mode systemd units and start automatically on login/boot.

```bash
# Check status
systemctl --user status myslack-backend.service myslack-frontend.service

# Restart both
systemctl --user restart myslack-backend.service myslack-frontend.service

# View live logs
journalctl --user -u myslack-backend -f
journalctl --user -u myslack-frontend -f
```

Service files:
- `/home/aksai/.config/systemd/user/myslack-backend.service`
- `/home/aksai/.config/systemd/user/myslack-frontend.service`

Node.js runtime: `/home/aksai/.local/share/fnm/node-versions/v22.22.2/installation/bin/`

> If you upgrade Node via fnm, update the `Environment=PATH=...` line in both service files and run `systemctl --user daemon-reload`.

---

## Checklist: What to Update When Making Changes

| Change                              | Action required                                                                                     |
|-------------------------------------|-----------------------------------------------------------------------------------------------------|
| New API route on backend            | Nothing — Cloudflare/tunnel routes all traffic on `slack-api.akstest.win` to port 3000             |
| New frontend page/screen            | Nothing — Metro serves all routes on port 19006                                                     |
| Change API domain                   | 1. Update `.env` `EXPO_PUBLIC_API_URL` 2. Update fallbacks in all 4 client files 3. Update CORS in `server/src/app.js` 4. Update cloudflared-config.yml 5. Restart Metro + cloudflared |
| Add a new public subdomain          | Add entry in `cloudflared-config.yml` → `docker restart asx-cloudflared`                           |
| Change backend port (3000)          | Update `cloudflared-config.yml` ingress + restart container                                         |
| Change frontend port (19006)        | Update `cloudflared-config.yml` + update `npm run web` port flag + restart Metro service            |
| Upgrade Node.js version             | Update PATH in both `.service` files → `systemctl --user daemon-reload`                             |
| Change `EXPO_PUBLIC_*` env vars     | Restart Metro: `systemctl --user restart myslack-frontend.service`                                  |
| Change backend-only env vars        | Restart backend: `systemctl --user restart myslack-backend.service`                                 |
| Mac M1 Ollama offline               | Groq takes over automatically (fallback chain: groq → local → openai)                              |
