const {
  jidNormalizedUser
} = require("@whiskeysockets/baileys");
const chalk = require("chalk");
const axios = require("axios");
const fs = require("fs");

module.exports = async (sock, msg, store) => {
  const type = Object.keys(msg.message)[0];
  const body = type === "conversation" ? msg.message.conversation : type === "extendedTextMessage" ? msg.message.extendedTextMessage.text : type === "imageMessage" ? msg.message.imageMessage.caption : type === "videoMessage" ? msg.message.videoMessage.caption : "";
  const prefix = /^[°•π÷×¶∆£¢€¥®™✓_=|~!?#$%^&.+-,\/\\©^]/.test(body) ? body.match(/^[°•π÷×¶∆£¢€¥®™✓_=|~!?#$%^&.+-,\/\\©^]/gi) : "#";
  const isCmd = body.startsWith(prefix);
  const command = isCmd ? body.slice(prefix.length).trim().split(" ").shift().toLowerCase() : "";
  const args = body.trim().split(/ +/).slice(1);
  const text = args.join(" ") || "";

  const from = msg.key.remoteJid;
  const isGroup = from.endsWith("@g.us");
  const metadata = store.groupMetadata[from] || await sock.groupMetadata(from);
  const participant = jidNormalizedUser(msg?.participant || msg.key.participant) || false;
  const sender = jidNormalizedUser(msg.key.fromMe ? sock.user.id : isGroup ? participant : from);
  const isOwner = sender && [sock.user.jid.split("@")[0], process.env.OWNER_NUMBER].includes(sender.replace(/\D+/g, ""));

  if (type !== "protocolMessage") {
    if (isCmd && !isGroup) {
      console.log(
        chalk.bold.bgRgb(51, 204, 51)("CEMD "),
        chalk.rgb(255, 255, 255)(`[${new Date().toUTCString()}]:`),
        chalk.green(command),
        "from",
        chalk.green(msg.pushName)
      );
    } else if (isCmd && isGroup) {
      console.log(
        chalk.bold.bgRgb(51, 204, 51)("CEMD "),
        chalk.rgb(255, 255, 255)(`[${new Date().toUTCString()}]:`),
        chalk.green(command),
        "from",
        chalk.green(msg.pushName),
        "in",
        chalk.green(metadata.subject)
      );
    }
  }

  const reply = (teks) => {
    sock.sendMessage(from, {
      text: teks,
      contextInfo: {
        externalAdReply: {
          title: "DON'T SPAM !!!",
          body: `👋🏻 Hai kak ${msg.pushName}`,
          previewType: "PHOTO",
          thumbnail: fs.readFileSync("./megumi.jpg"),
          sourceUrl: process.env.URL
        }
      }
    }, {
      quoted: msg
    });
  }

  switch (command) {
    case "openai": {
      if (!text) return reply("Apa yg ingin di tanyakan?");
      axios.get(process.env.BASE_URL + `openai?text=${text}`).then(({
        data
      }) => {
        return reply(data.result);
      }).catch(console.error);
    }
    break;
    case "gpt": {
      if (!text) return reply("Apa yg ingin di tanyakan?");
      axios.get(process.env.BASE_URL + `prompt/gpt?prompt=Kamu adalah ChatGpt, asisten virtual yang diberi nama Nexa. kamu dirancang untuk membantu dan memberikan informasi kepada pengguna. mulai dari seni,budaya,teknologi,dan lainya&text=${encodeURIComponent(text)}`).then(({
        data
      }) => {
        return reply(data.result);
      }).catch(console.error);
    }
    break;
    case "gpt4": {
      if (!text) return reply("Apa yg ingin di tanyakan?");
      axios.get(process.env.BASE_URL + `v2/gpt4?text=${encodeURIComponent(text)}`).then(({
        data
      }) => {
        return reply(data.result);
      }).catch(console.error);
    }
    break; 
    case "tinyurl": {
      if (!text) return reply("Where the url?");
      axios.get(process.env.BASE_URL + `tinyurl?link=${encodeURIComponent(text)}`).then(({
        data
      }) => {
        return reply(data.result);
      }).catch(console.error);
    }
    break;
  }
}