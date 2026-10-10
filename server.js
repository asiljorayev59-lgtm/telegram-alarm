const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const input = require("input");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const apiId = 33806129;
const apiHash = "061b0993fa0dc48c73ac2a924e5d8480";

// Dastlabki monitored chatlar
let monitoredChats = [-1001552009111, -1002029590547, -1003741592592, -1001974731753];

const app = express();
app.use(express.json());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(__dirname));

// Kanallarni olish va qo'shish/o'chirish uchun API
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

async function startTelegram() {
  const client = new TelegramClient(new StringSession(""), apiId, apiHash, {
    connectionRetries: 5,
  });

  console.log("Telegramga ulanish boshlandi...");
  await client.start({
    phoneNumber: async () => await input.text("Telefon raqamingiz (+998...): "),
    password: async () => await input.text("2-bosqichli parol (agar bo'lsa): "),
    phoneCode: async () => await input.text("Telegramdan kelgan kodni kiriting: "),
    onError: (err) => console.log(err),
  });

  console.log("✅ Telegramga muvaffaqiyatli ulandi! Kanallar kuzatilmoqda...");

  client.addEventHandler(async (event) => {
    const message = event.message;
    if (message && message.peerId) {
      let chatId = null;
      if (message.peerId.channelId) {
        chatId = Number("-100" + message.peerId.channelId.toString());
      } else if (message.peerId.chatId) {
        chatId = Number("-" + message.peerId.chatId.toString());
      }

      if (monitoredChats.includes(chatId)) {
        console.log(`🚨 Yangi xabar keldi! Kanal ID: ${chatId}`);
        io.emit("telegram_alarm", {
          chatId: chatId,
          text: message.message || "[Media / Rasm / Video]",
          date: new Date().toLocaleTimeString(),
        });
      }
    }
  });
}

io.on("connection", (socket) => {
  console.log("📱 Ilova ulandi!");
  socket.emit('channels_updated', monitoredChats);
});

server.listen(3000, () => {
  console.log("Server 3000-portda ishlamoqda...");
  startTelegram();
});
