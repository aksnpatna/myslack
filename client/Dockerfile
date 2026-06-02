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

# SPA routing — send all routes to index.html
RUN printf 'server {\n  listen 80;\n  root /usr/share/nginx/html;\n  index index.html;\n  location / { try_files $uri $uri/ /index.html; }\n}\n' > /etc/nginx/conf.d/default.conf

EXPOSE 80
