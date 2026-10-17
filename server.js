const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");

const apiId = 33806129;
const apiHash = "061b0993fa0dc48c73ac2a924e5d8480";

const SESSIONS_FILE = path.join(__dirname, "sessions.json");
const CHANNELS_FILE = path.join(__dirname, "channels.json");

// Sessiyalarni yuklash
function loadSavedSessions() {
    if (fs.existsSync(SESSIONS_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(SESSIONS_FILE, "utf8"));
        } catch (e) {
            return {};
        }
    }
    return {};
}

function saveSessionsToFile(sessions) {
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
}

// Kanallarni yuklash va saqlash
function loadSavedChannels() {
    if (fs.existsSync(CHANNELS_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(CHANNELS_FILE, "utf8"));
        } catch (e) {
            return [-1001552009111, -1002029590547, -1003741592592, -1001974731753];
        }
    }
    return [-1001552009111, -1002029590547, -1003741592592, -1001974731753];
}

function saveChannelsToFile(channels) {
    fs.writeFileSync(CHANNELS_FILE, JSON.stringify(channels, null, 2));
}

let monitoredChats = loadSavedChannels();
let clients = [];
let tempClient = null;
let savedPhone = '';

const app = express();
app.use(express.json());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(__dirname));

process.on('uncaughtException', (err) => {
    console.log('Kutilmagan xatolik:', err.message);
});
process.on('unhandledRejection', (reason) => {
    console.log("Rad etish:", reason);
});

async function restoreSessions() {
    const sessions = loadSavedSessions();
    for (const [phone, data] of Object.entries(sessions)) {
        try {
            const client = new TelegramClient(new StringSession(data.sessionString), apiId, apiHash, { connectionRetries: 5 });
            await client.connect();
            if (await client.isUserAuthorized()) {
                clients.push({ phone, client });
                setupEventHandlers(client);
                console.log(`✅ Qayta tiklandi: ${phone}`);
            }
        } catch (e) {
            console.log(`❌ Sessiyani tiklashda xatolik (${phone}):`, e.message);
        }
    }
}

app.get('/api/channels', (req, res) => {
  res.json(monitoredChats);
});

app.post('/api/channels', (req, res) => {
  const { chatId } = req.body;
  if (chatId && !monitoredChats.includes(Number(chatId))) {
    monitoredChats.push(Number(chatId));
    saveChannelsToFile(monitoredChats);
    io.emit('channels_updated', monitoredChats);
  }
  res.json(monitoredChats);
});

app.delete('/api/channels/:id', (req, res) => {
  const chatId = Number(req.params.id);
  monitoredChats = monitoredChats.filter(id => id !== chatId);
  saveChannelsToFile(monitoredChats);
  io.emit('channels_updated', monitoredChats);
  res.json(monitoredChats);
});

app.get('/api/auth/sessions', (req, res) => {
    res.json({ success: true, sessions: clients.map(c => c.phone) });
});

app.post('/api/auth/send-code', async (req, res) => {
  const { phone } = req.body;
  if (clients.length >= 3) {
    return res.status(400).json({ success: false, message: "Maksimal 3 ta raqam ulangan!" });
  }
  savedPhone = phone;
  try {
    tempClient = new TelegramClient(new StringSession(""), apiId, apiHash, { connectionRetries: 5, timeout: 30000 });
    await tempClient.connect();
    await tempClient.sendCode({ apiId, apiHash }, phone);
    res.json({ success: true, message: "SMS kod yuborildi!" });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

app.post('/api/auth/verify-code', async (req, res) => {
  const { code, password } = req.body;
  try {
    await tempClient.start({
      phoneNumber: async () => savedPhone,
      phoneCode: async () => code,
      password: async () => password || "",
      onError: (err) => console.log(err),
    });

    const sessionString = tempClient.session.save();
    let sessions = loadSavedSessions();
    sessions[savedPhone] = { sessionString };
    saveSessionsToFile(sessions);

    clients.push({ phone: savedPhone, client: tempClient });
    setupEventHandlers(tempClient);
    
    io.emit('telegram_status', { connected: true, count: clients.length, sessions: clients.map(c => c.phone) });
    res.json({ success: true, message: "Raqam muvaffaqiyatli ulandi va eslab qolindi!" });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

app.post('/api/auth/logout', (req, res) => {
    const { phone } = req.body;
    let sessions = loadSavedSessions();
    if (sessions[phone]) {
        delete sessions[phone];
        saveSessionsToFile(sessions);
    }
    clients = clients.filter(c => c.phone !== phone);
    io.emit('telegram_status', { connected: clients.length > 0, count: clients.length, sessions: clients.map(c => c.phone) });
    res.json({ success: true, message: "Akkaunt o'chirildi." });
});

function setupEventHandlers(activeClient) {
  activeClient.addEventHandler(async (event) => {
    try {
      const message = event.message;
      if (message && message.peerId) {
        let chatId = null;
        if (message.peerId.channelId) {
          chatId = Number("-100" + message.peerId.channelId.toString());
        } else if (message.peerId.chatId) {
          chatId = Number("-" + message.peerId.chatId.toString());
        }

        if (monitoredChats.includes(chatId)) {
          console.log(`🚨 Yangi xabar! Kanal ID: ${chatId}`);
          io.emit("telegram_alarm", {
            chatId: chatId,
            text: message.message || "[Media / Rasm / Video]",
            date: new Date().toLocaleTimeString(),
          });
        }
      }
    } catch (e) {
      console.log("Xabarni o'qishda xatolik:", e.message);
    }
  });
}

io.on("connection", (socket) => {
  socket.emit('channels_updated', monitoredChats);
  socket.emit('telegram_status', { connected: clients.lock > 0, count: clients.length, sessions: clients.map(c => c.phone) });
});

server.listen(3000, async () => {
  console.log("Server 3000-portda ishlamoqda...");
  await restoreSessions();
});
