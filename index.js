"use strict";

require("dotenv").config();
require("http").createServer((_, res) => res.end("Uptime!")).listen(8080)

const {
  makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  jidNormalizedUser,
  PHONENUMBER_MCC,
  makeCacheableSignalKeyStore,
  makeInMemoryStore,
  delay
} = require("@whiskeysockets/baileys");
const {
  Boom
} = require("@hapi/boom");
const {
  format
} = require("util");
const NodeCache = require("node-cache");
const pino = require("pino");
const readline = require("readline");
const chalk = require("chalk");

const pairingCode = process.argv.includes("--code");
const qrCode = process.argv.includes("--qr");
const useMobile = process.argv.includes("--mobile");

const store = makeInMemoryStore({ logger: pino({ level: "silent", stream: "store" }) });

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (text) => new Promise((resolve) => rl.question(text, resolve));

const msgRetryCounterCache = new NodeCache();

const startWASocket = async () => {
  process.on("unhandledRejection", (err) => console.error(err));

  const { state, saveCreds } = await useMultiFileAuthState(process.env.SESSION_NAME);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version, // whatsapp version 
    msgRetryCounterCache, // Resolve waiting messages
    printQRInTerminal: process.env.PAIRING_CODE === "false", // popping up QR in terminal log
    mobile: useMobile, // mobile api (prone to bans)
    generateHighQualityLinkPreview: true, // make high preview link
    markOnlineOnConnect: true, // set false for offline
    defaultQueryTimeoutMs: undefined, // for this issues https://github.com/WhiskeySockets/Baileys/issues/276
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({
        level: "silent"
      }))
    },
    getMessage: async (key) => {
      if (store) {
        const msg = await store.loadMessage(key.remoteJid, key.id);
        return msg?.message || undefined;
      }
      return {
        conversation: process.env.BOT_NAME
      };
    },
    logger: pino({
      level: "silent"
    }),
    browser: [
      "Mac OS",
      "chrome",
      "121.0.6167.159"
    ] // fix pairing code issue https://github.com/WhiskeySockets/Baileys/issues/636
  });

  // login mobile API (prone to bans)
  // source code https://github.com/WhiskeySockets/Baileys/blob/master/Example/example.ts#L72
  if (process.env.PAIRING_CODE === "true" || pairingCode) {
    if (!sock.authState.creds.registered) {
      if (useMobile) throw new Error("Cannot use pairing code with mobile API");

      let phoneNumber;
      if (!!phoneNumber) {
        phoneNumber = phoneNumber.replace(/[^0-9]/g, "");
        if (!Object.keys(PHONENUMBER_MCC).some(v => phoneNumber.startsWith(v))) {
          console.log(chalk.bold.bgRgb(255, 153, 0)(format("Start with country code of your WhatsApp Number, Example : 628xxxx\n> ")));
          process.exit(0);
        }
        rl.close();
      } else {
        phoneNumber = await question(chalk.bold.bgRgb(51, 204, 51)(format("Please enter your WhatsApp number, for example: 628xxx\n> ")));
        phoneNumber = phoneNumber.replace(/[^0-9]/g, "");
        if (!Object.keys(PHONENUMBER_MCC).some(v => phoneNumber.startsWith(v))) {
          console.log(chalk.bold.bgRgb(255, 153, 0)(format("Start with country code of your WhatsApp Number, Example : 628xxxx\n> ")));
          phoneNumber = await question(chalk.bold.bgRgb(51, 204, 51)(format("Please enter your WhatsApp number, for example: 628xxx\n> ")));
          phoneNumber = phoneNumber.replace(/[^0-9]/g, "");
          rl.close();
        }
      }

      setTimeout(async () => {
        let code = await sock.requestPairingCode(phoneNumber);
        code = code.match(/.{1,4}/g).join("-") || code;
        console.log(chalk.bold.bgRgb(51, 204, 51)("PAIRING CODE "), chalk.bold.white(format(code)));
      }, 0);
    }
  }

  // bind store
  store.bind(sock.ev);

  // write store set in .env file
  setInterval(async () => {
    if (process.env.WRITE_STORE === "true") await store.writeToFile("./store.json");
  }, 10000);

  // events
  sock.ev.process(async (events) => {
    // for auto restart when error client
    if (events["connection.update"]) {
      rl.close();
      const update = events["connection.update"];
      const {
        connection,
        lastDisconnect,
        qr
      } = update;
      const reason = new Boom(lastDisconnect?.error)?.output.statusCode;
      if (qr != 0 && qr != undefined || qrCode) {
        if (process.env.PAIRING_CODE === "false") {
          console.log(chalk.bold.bgRgb(51, 204, 51)("INFO "), `[${chalk.rgb(255, 255, 255)(new Date().toUTCString())}]:`, chalk.cyan(format("Scan this QR code to run the bot, max 60 seconds")));
        }
      } else if (connection === "close") {
        if (reason !== DisconnectReason.loggedOut) {
          await startWASocket();
        } else {
          console.log(chalk.bold.bgRgb(51, 204, 51)("INFO "), `[${chalk.rgb(255, 255, 255)(new Date().toUTCString())}]:`, chalk.cyan(format("Connection closed. You are logged out")));
          process.exit();
        }
      } else if (connection === "connecting") {
        console.log(chalk.bold.bgRgb(51, 204, 51)("INFO "), `[${chalk.rgb(255, 255, 255)(new Date().toUTCString())}]:`, chalk.cyan(format("Connecting...")));
      } else if (connection === "open") {
        await store.chats.all();
        console.log(chalk.bold.bgRgb(51, 204, 51)("INFO "), `[${chalk.rgb(255, 255, 255)(new Date().toUTCString())}]:`, chalk.cyan(format("Connected!")));
      }
    }

    // write session
    if (events["creds.update"]) {
      await saveCreds();
    }

    // call 
    if (events["call"]) {
      const m = events["call"][0];
      if (m.status === "offer") {
        await sock.rejectCall(call.id, call.from);
        if (!m.isGroup) {
          await delay(100);
          await sock.sendMessage(m.from, {
            text: `Maaf @${m.from.split("@")[0]}\nPanggilan terdeteksi, kamu di blok secara otomatis\nSilakan hubungi owner jika tidak sengaja :D`,
            mentions: [m.from]
          });
          const vcard = "BEGIN:VCARD\n" // metadata of the contact card
            +
            "VERSION:3.0\n" +
            "FN:Hyung \n" // full name
            +
            "ORG:Owner Bot;\n" // the organization of the contact
            +
            "TEL;type=CELL;type=VOICE;waid=" + process.env.OWNER_NUMBER + ":+62 889 8387 9021\n" // WhatsApp ID + phone number
            +
            "END:VCARD"
          await sock.sendMessage(m.from, {
            contacts: {
              displayName: "Hyung",
              contacts: [{
                vcard
              }]
            }
          });
          await delay(5000);
          await sock.updateBlockStatus(m.from, "block")
          return;
        }
      }
    }

    // group update
    if (events["groups.update"]) {
      const m = events["groups.update"];
      try {
        for (const action of m) {
          let profile;
          try {
            profile = await sock.profilePictureUrl(action.id, "image");
          } catch {
            profile = "https://lh3.googleusercontent.com/proxy/esjjzRYoXlhgNYXqU8Gf_3lu6V-eONTnymkLzdwQ6F6z0MWAqIwIpqgq_lk4caRIZF_0Uqb5U8NWNrJcaeTuCjp7xZlpL48JDx-qzAXSTh00AVVqBoT7MJ0259pik9mnQ1LldFLfHZUGDGY=w1200-h630-p-k-no-nu";
          }

          if (action.announce) {
            sock.sendMessage(action.id, {
              text: "Group has been Closed",
              contextInfo: {
                externalAdReply: {
                  title: process.env.DESCRIPTION,
                  mediaType: 1,
                  previewType: 0,
                  renderLargerThumbnail: true,
                  thumbnailUrl: profile,
                  sourceUrl: process.env.URL
                }
              }
            });
          } else if (!action.announce) {
            sock.sendMessage(action.id, {
              text: "Group is opened",
              contextInfo: {
                externalAdReply: {
                  title: process.env.DESCRIPTION,
                  mediaType: 1,
                  previewType: 0,
                  renderLargerThumbnail: true,
                  thumbnailUrl: profile,
                  sourceUrl: process.env.URL
                }
              }
            });
          }
        }
      } catch (e) {
        console.log(e);
      }
    }

    // group participants update
    if (events["group-participants.update"]) {
      const m = events["group-participants.update"];
      try {
        const metadata = await sock.groupMetadata(m.id);
        for (const jid of m.participants) {
          let profile;
          try {
            profile = await sock.profilePictureUrl(jid, "image");
          } catch {
            profile = "https://lh3.googleusercontent.com/proxy/esjjzRYoXlhgNYXqU8Gf_3lu6V-eONTnymkLzdwQ6F6z0MWAqIwIpqgq_lk4caRIZF_0Uqb5U8NWNrJcaeTuCjp7xZlpL48JDx-qzAXSTh00AVVqBoT7MJ0259pik9mnQ1LldFLfHZUGDGY=w1200-h630-p-k-no-nu";
          }

          if (m.action == "add") {
            sock.sendMessage(m.id, {
              text: `Welcome @${jid.split("@")[0]} to "${metadata.subject}"`,
              contextInfo: {
                mentionedJid: [jid],
                externalAdReply: {
                  title: process.env.DESCRIPTION,
                  mediaType: 1,
                  previewType: 0,
                  renderLargerThumbnail: true,
                  thumbnailUrl: profile,
                  sourceUrl: process.env.URL
                }
              }
            });
          } else if (m.action == "remove") {
            sock.sendMessage(m.id, {
              text: `@${jid.split("@")[0]} Leaving From "${metadata.subject}"`,
              contextInfo: {
                mentionedJid: [jid],
                externalAdReply: {
                  title: process.env.DESCRIPTION,
                  mediaType: 1,
                  previewType: 0,
                  renderLargerThumbnail: true,
                  thumbnailUrl: profile,
                  sourceUrl: process.env.URL
                }
              }
            });
          }
        }
      } catch (e) {
        console.log(e);
      }
    }

    // message
    if (events["messages.upsert"]) {
      const upsert = events["messages.upsert"];
      if (upsert.type === "notify") {
        for (const msg of upsert.messages) {
          try {
            if (!msg) return;
            if (!msg.message) return;
            if (msg.key && msg.key.remoteJid == "status@broadcast") return;
            (await require("./megumi")(sock, msg, store));
          } catch (error) {
            console.log(chalk.bold.bgRgb(247, 38, 33)("ERROR "), `[${chalk.rgb(255, 255, 255)(new Date().toUTCString())}]:`, chalk.rgb(255, 38, 0)(format(error)));
          }
        }
      }
    }
  });

  if (sock.user && sock.user.id) {
    sock.user.jid = jidNormalizedUser(sock.user.id);
  }

  return sock;
};

startWASocket();