FROM node:22-alpine AS builder

# The myslack monorepo has node_modules at the root level
# and the client app at ./client/
WORKDIR /monorepo

# Copy root package files and node_modules
COPY package.json ./
COPY node_modules ./node_modules

# Copy the client app
COPY client ./client

WORKDIR /monorepo/client

# Bake public env vars at build time
ARG EXPO_PUBLIC_API_URL=https://slack-api.akstest.win
ARG EXPO_PUBLIC_WS_URL=wss://slack-api.akstest.win/ws/chat
ENV EXPO_PUBLIC_API_URL=$EXPO_PUBLIC_API_URL
ENV EXPO_PUBLIC_WS_URL=$EXPO_PUBLIC_WS_URL

RUN /monorepo/node_modules/.bin/expo export --platform web --output-dir /dist

# ── Production: serve static build ──────────────────────────────────────────
FROM nginx:alpine

COPY --from=builder /dist /usr/share/nginx/html

RUN cat << 'NGINXEOF' > /etc/nginx/conf.d/default.conf
server {
  listen 80;
  root /usr/share/nginx/html;
  index index.html;

  gzip on;
  gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;

  location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|json)$ {
    expires 1y;
    add_header Cache-Control "public, immutable";
    try_files $uri =404;
  }

  location / {
    try_files $uri $uri/ /index.html;
  }
}
NGINXEOF

EXPOSE 80
