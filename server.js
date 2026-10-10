const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const apiId = 33806129;
const apiHash = "061b0993fa0dc48c73ac2a924e5d8480";

let monitoredChats = [-1001552009111, -1002029590547, -1003741592592, -1001974731753];
let clients = [];
let tempClient = null;

const app = express();
app.use(express.json());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(__dirname));

process.on('uncaughtException', (err) => {
    console.log('Kutilmagan xatolik (server ishda qoladi):', err.message);
});
process.on('unhandledRejection', (reason, promise) => {
    console.log("Ushlanmagan va'da rad etishi:", reason);
});

app.get('/api/channels', (req, res) => {
  res.json(monitoredChats);
});

app.post('/api/channels', (req, res) => {
  const { chatId } = req.body;
  if (chatId && !monitoredChats.includes(Number(chatId))) {
    monitoredChats.push(Number(chatId));
    io.emit('channels_updated', monitoredChats);
  }
  res.json(monitoredChats);
});

app.delete('/api/channels/:id', (req, res) => {
  const chatId = Number(req.params.id);
  monitoredChats = monitoredChats.filter(id => id !== chatId);
  io.emit('channels_updated', monitoredChats);
  res.json(monitoredChats);
});

let savedPhone = '';
let savedCode = '';
let savedPassword = '';

app.post('/api/auth/send-code', async (req, res) => {
  const { phone } = req.body;
  if (clients.length >= 3) {
    return res.status(400).json({ success: false, message: "Maksimal 3 ta raqam ulangan!" });
  }
  savedPhone = phone;
  try {
    tempClient = new TelegramClient(new StringSession(""), apiId, apiHash, { 
      connectionRetries: 10,
      timeout: 30000 
    });
    await tempClient.connect();
    const result = await tempClient.sendCode({ apiId, apiHash }, phone);
    res.json({ success: true, message: "SMS kod yuborildi!" });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

app.post('/api/auth/verify-code', async (req, res) => {
  const { code, password } = req.body;
  savedCode = code;
  savedPassword = password || "";

  try {
    await tempClient.start({
      phoneNumber: async () => savedPhone,
      phoneCode: async () => savedCode,
      password: async () => savedPassword,
      onError: (err) => console.log(err),
    });

    clients.push({ phone: savedPhone, client: tempClient });
    setupEventHandlers(tempClient);
    
    io.emit('telegram_status', { connected: true, count: clients.length });
    res.json({ success: true, message: "Raqam muvaffaqiyatli ulandi!" });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

function setupEventHandlers(activeClient) {
  console.log("✅ Telegram sessiyasi qo'shildi va kuzatilmoqda...");

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
  socket.emit('telegram_status', { connected: clients.length > 0, count: clients.length });
});

server.listen(3000, () => {
  console.log("Server 3000-portda ultra-tez rejimda ishlamoqda...");
});
