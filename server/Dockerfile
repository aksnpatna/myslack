FROM node:22-alpine

WORKDIR /app

# Copy package files and install deps
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Copy source
COPY . .

EXPOSE 3000
CMD ["node", "src/app.js"]
