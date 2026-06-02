# MySlack 🚀

A modern, high-performance real-time chat and communication platform inspired by Slack. Built with **React Native / Expo** on the frontend, **Fastify** on the backend, **PostgreSQL** for data persistence, and **LiveKit** for seamless, low-latency audio/video huddles.

---

## 🌟 Key Features

- **Real-Time Messaging**: Instant chat messaging, group channels, and private direct messages.
- **Audio & Video Huddles**: Premium-grade real-time voice and video rooms powered by LiveKit.
- **Modern Architecture**: Fastify backend for robust, asynchronous speed, and Expo for cross-platform visual excellence.
- **AI Processing Layer**: Modular integration with Groq, Local LLMs (Ollama), and OpenAI for smart assistance.
- **Rich Media & Attachments**: Fast upload and storage of files and documents.

---

## 🛠️ Technology Stack

| Layer | Technology |
| :--- | :--- |
| **Frontend** | React Native, Expo, React Native Web |
| **Backend** | Fastify (Node.js 22+), WebSockets |
| **Real-time Media**| LiveKit Server SDK / LiveKit Client |
| **Database** | PostgreSQL |
| **AI Assistants** | Groq, OpenAI, Ollama (Local) |

---

## 🚀 Getting Started

### 📋 Prerequisites

- **Node.js**: `v22` or later
- **Docker**: For running PostgreSQL and LiveKit services locally
- **Expo Go** (optional): For testing mobile builds on physical devices

### ⚙️ Backend Setup

1. **Configure Environment Variables**:
   Copy `.env.example` (or create a `.env` in the root directory) and set up the corresponding database credentials, LLM API keys, and LiveKit keys.

2. **Start Infrastructure Services**:
   Spin up PostgreSQL and LiveKit containers:
   ```bash
   docker-compose up -d
   ```

3. **Install Dependencies and Start Server**:
   ```bash
   cd server
   npm install
   npm run dev
   ```

### 📱 Frontend (Client) Setup

1. **Install Client Dependencies**:
   ```bash
   cd client
   npm install
   ```

2. **Start the Expo Dev Server**:
   ```bash
   npm run start
   # Or for web target:
   npm run web
   ```

---

## 📂 Project Structure

```
myslack/
├── client/              # React Native & Expo mobile/web application
│   ├── src/             # Frontend source code
│   └── App.js           # App Entry point
├── server/              # Fastify backend application
│   ├── src/             # Backend endpoints, controllers & models
│   └── app.js           # Main Fastify application entry
├── db/                  # Database migration & schema definitions
├── docker-compose.yml   # Multi-container local infrastructure (Postgres, LiveKit)
└── NETWORK.md           # Network design, ingress & routing specifications
```

---

## 🔒 License

Private/Proprietary. All rights reserved.
