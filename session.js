const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const input = require("input");

const apiId = 33806129; // Sizning API ID
const apiHash = "061b0993fa0dc48c73ac2a924e5d8480"; // Sizning API Hash
const stringSession = new StringSession("");

(async () => {
  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
  });
  await client.start({
    phoneNumber: async () => await input.text("Telefon raqamingiz (+998...): "),
    password: async () => await input.text("Parolingiz (agar bo'lsa): "),
    phoneCode: async () => await input.text("SMS kodni kiriting: "),
    onError: (err) => console.log(err),
  });
  console.log("\n--- SIZNING SESSION STRING'INGIZ (BUNI NUSXALANG) ---");
  console.log(client.session.save());
  process.exit(0);
})();
