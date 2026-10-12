require("dotenv").config();

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  jidNormalizedUser
} = require("@whiskeysockets/baileys");
const P = require("pino");
const qrcode = require("qrcode-terminal");
const fs = require("fs");
const path = require("path");

const PREFIX = process.env.PREFIX || "!";
const ANTI_LINK_DEFAULT = (process.env.ANTI_LINK || "true").toLowerCase() === "true";
const ANTI_SPAM_DEFAULT = (process.env.ANTI_SPAM || "true").toLowerCase() === "true";
const SPAM_LIMIT = Math.max(2, Number(process.env.SPAM_LIMIT || 6));
const SPAM_WINDOW_MS = Math.max(1000, Number(process.env.SPAM_WINDOW_MS || 10000));
const FLOOD_LIMIT = Math.max(2, Number(process.env.FLOOD_LIMIT || 3));
const WELCOME_DEFAULT = (process.env.WELCOME_DEFAULT || "true").toLowerCase() === "true";

const DATA_DIR = process.env.DATA_DIR || __dirname;
const AUTH_DIR = path.join(DATA_DIR, "auth_info");
const LOG_DIR = path.join(DATA_DIR, "logs");
fs.mkdirSync(AUTH_DIR, { recursive: true });
fs.mkdirSync(LOG_DIR, { recursive: true });

const recentMessages = new Map();
const repeatedMessages = new Map();
const groupSettings = new Map();

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  try {
    fs.appendFileSync(path.join(LOG_DIR, "bot.log"), line + "\n");
  } catch (e) {
    console.error("Não foi possível gravar logs em ficheiro:", e.message);
  }
}
function normalizeJid(jid) { return jidNormalizedUser(jid || ""); }
function getText(msg) {
  const m = msg.message || {};
  return m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption || "";
}
function isLink(text) {
  return /(https?:\/\/|www\.|chat\.whatsapp\.com\/|t\.me\/|bit\.ly\/)/i.test(text);
}
function isAdminParticipant(participant) {
  return participant?.admin === "admin" || participant?.admin === "superadmin";
}
async function groupInfo(sock, groupJid) {
  const metadata = await sock.groupMetadata(groupJid);
  return {
    metadata,
    admins: metadata.participants.filter(isAdminParticipant).map(p => normalizeJid(p.id))
  };
}
async function senderIsAdmin(sock, groupJid, senderJid) {
  const info = await groupInfo(sock, groupJid);
  return info.admins.includes(normalizeJid(senderJid));
}
async function botIsAdmin(sock, groupJid) {
  const info = await groupInfo(sock, groupJid);
  return info.admins.includes(normalizeJid(sock.user.id));
}
async function reply(sock, jid, text, quoted) {
  return sock.sendMessage(jid, { text }, quoted ? { quoted } : {});
}
function getTargets(msg) {
  const ctx = msg.message?.extendedTextMessage?.contextInfo;
  const mentioned = ctx?.mentionedJid || [];
  const quotedParticipant = ctx?.participant;
  return mentioned.length ? mentioned : (quotedParticipant ? [quotedParticipant] : []);
}
function getSettings(groupJid) {
  if (!groupSettings.has(groupJid)) {
    groupSettings.set(groupJid, {
      antiLink: ANTI_LINK_DEFAULT,
      antiSpam: ANTI_SPAM_DEFAULT,
      welcome: WELCOME_DEFAULT
    });
  }
  return groupSettings.get(groupJid);
}
function recentWithin(map, key, maxAge) {
  const now = Date.now();
  const arr = (map.get(key) || []).filter(item => now - item.time < maxAge);
  map.set(key, arr);
  return arr;
}
async function requireGroupAdmin(sock, msg, groupJid, senderJid) {
  // Apenas administradores reais do grupo podem usar comandos de moderação.
  if (!(await senderIsAdmin(sock, groupJid, senderJid))) {
    await reply(sock, groupJid, "⛔ Este comando só pode ser usado por administradores do grupo.", msg);
    return false;
  }
  if (!(await botIsAdmin(sock, groupJid))) {
    await reply(sock, groupJid, "⚠️ Promove o bot a administrador para permitir banir, apagar mensagens e abrir/fechar o grupo.", msg);
    return false;
  }
  return true;
}

async function handleCommand(sock, msg, groupJid, senderJid, text) {
  const [rawCommand, ...args] = text.slice(PREFIX.length).trim().split(/\s+/);
  const command = (rawCommand || "").toLowerCase();
  const adminCommands = [
    "ban", "kick", "add", "close", "fechar", "open", "abrir",
    "welcome", "boasvindas", "antilink", "antispam"
  ];

  if (adminCommands.includes(command) &&
      !(await requireGroupAdmin(sock, msg, groupJid, senderJid))) return true;

  try {
    if (["menu", "help", "ajuda"].includes(command)) {
      return await reply(sock, groupJid,
`🤖 *BOT DE GRUPO — COMANDOS*
${PREFIX}menu — mostrar ajuda
${PREFIX}ban @membro — remover membro (menciona ou responde à mensagem)
${PREFIX}add 258XXXXXXXXX — tentar adicionar número com código do país
${PREFIX}close — só administradores podem enviar mensagens
${PREFIX}open — todos podem enviar mensagens
${PREFIX}welcome on/off — boas-vindas automáticas
${PREFIX}antilink on/off — moderação de links
${PREFIX}antispam on/off — anti-spam e anti-flood
${PREFIX}id — ID do grupo

Ações administrativas exigem que quem envia seja administrador do grupo e que o bot também seja administrador.`, msg);
    }

    if (command === "id") {
      await reply(sock, groupJid, `ID do grupo: ${groupJid}`, msg);
      return true;
    }

    if (["ban", "kick"].includes(command)) {
      const targets = getTargets(msg);
      if (!targets.length) {
        await reply(sock, groupJid, `Menciona a pessoa ou responde à mensagem dela: ${PREFIX}ban @membro`, msg);
        return true;
      }
      const target = normalizeJid(targets[0]);
      if (target === normalizeJid(sock.user.id)) {
        await reply(sock, groupJid, "Não posso remover a mim próprio.", msg);
        return true;
      }
      await sock.groupParticipantsUpdate(groupJid, [target], "remove");
      log(`BAN group=${groupJid} admin=${senderJid} target=${target}`);
      await reply(sock, groupJid, "✅ Membro removido do grupo.", msg);
      return true;
    }

    if (command === "add") {
      const number = (args[0] || "").replace(/\D/g, "");
      if (number.length < 8) {
        await reply(sock, groupJid, `Uso: ${PREFIX}add 258XXXXXXXXX (código do país, sem +)`, msg);
        return true;
      }
      const result = await sock.groupParticipantsUpdate(groupJid, [`${number}@s.whatsapp.net`], "add");
      log(`ADD group=${groupJid} admin=${senderJid} number=${number}`);
      const status = result?.[0]?.status;
      await reply(sock, groupJid,
        status === "200"
          ? "✅ Pedido de adição enviado."
          : "ℹ️ O WhatsApp pode exigir um convite. Se a pessoa não entrar, partilha um convite do grupo.",
        msg);
      return true;
    }

    if (["close", "fechar"].includes(command)) {
      await sock.groupSettingUpdate(groupJid, "announcement");
      log(`CLOSE group=${groupJid} admin=${senderJid}`);
      await reply(sock, groupJid, "🔒 Grupo fechado: só administradores podem enviar mensagens.", msg);
      return true;
    }
    if (["open", "abrir"].includes(command)) {
      await sock.groupSettingUpdate(groupJid, "not_announcement");
      log(`OPEN group=${groupJid} admin=${senderJid}`);
      await reply(sock, groupJid, "🔓 Grupo aberto: todos podem enviar mensagens.", msg);
      return true;
    }

    if (["welcome", "boasvindas"].includes(command)) {
      const setting = (args[0] || "").toLowerCase();
      if (!["on", "off"].includes(setting)) {
        await reply(sock, groupJid, `Uso: ${PREFIX}welcome on/off`, msg);
        return true;
      }
      getSettings(groupJid).welcome = setting === "on";
      await reply(sock, groupJid, setting === "on" ? "👋 Boas-vindas ativadas." : "Boas-vindas desativadas.", msg);
      return true;
    }

    if (command === "antilink" || command === "antispam") {
      const setting = (args[0] || "").toLowerCase();
      if (!["on", "off"].includes(setting)) {
        await reply(sock, groupJid, `Uso: ${PREFIX}${command} on/off`, msg);
        return true;
      }
      const key = command === "antilink" ? "antiLink" : "antiSpam";
      getSettings(groupJid)[key] = setting === "on";
      await reply(sock, groupJid, `${command === "antilink" ? "Anti-link" : "Anti-spam/flood"} ${setting === "on" ? "ativado" : "desativado"}.`, msg);
      return true;
    }
  } catch (err) {
    log(`COMMAND_ERROR group=${groupJid} command=${command} error=${err.stack || err.message}`);
    await reply(sock, groupJid, `❌ Não consegui executar o comando. Confirma as permissões do bot.\nDetalhe: ${err.message}`, msg);
    return true;
  }
  return false;
}

async function handleMessage(sock, msg) {
  if (!msg.message || msg.key.fromMe) return;
  const groupJid = msg.key.remoteJid;
  if (!groupJid?.endsWith("@g.us")) return;
  const senderJid = msg.key.participant || msg.key.remoteJid;
  const text = getText(msg).trim();
  if (!text) return;

  if (text.startsWith(PREFIX)) {
    await handleCommand(sock, msg, groupJid, senderJid, text);
    return;
  }

  const settings = getSettings(groupJid);
  const senderAdmin = await senderIsAdmin(sock, groupJid, senderJid).catch(() => false);
  if (senderAdmin) return; // Não moderar mensagens de administradores.

  if (settings.antiLink && isLink(text)) {
    try {
      await sock.sendMessage(groupJid, { delete: msg.key });
      await reply(sock, groupJid, "🚫 Link removido: links não são permitidos neste grupo.");
      log(`ANTILINK group=${groupJid} sender=${senderJid}`);
    } catch (err) {
      log(`ANTILINK_ERROR group=${groupJid} error=${err.message}`);
    }
    return;
  }

  if (settings.antiSpam) {
    const key = `${groupJid}:${senderJid}`;
    const now = Date.now();
    const recent = recentWithin(recentMessages, key, SPAM_WINDOW_MS);
    recent.push({ time: now });
    recentMessages.set(key, recent);
    const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
    const repeated = recentWithin(repeatedMessages, key, 30000);
    repeated.push({ time: now, text: normalized });
    repeatedMessages.set(key, repeated);
    const sameCount = repeated.filter(item => item.text === normalized).length;

    if (recent.length > SPAM_LIMIT || sameCount >= FLOOD_LIMIT) {
      try {
        await sock.sendMessage(groupJid, { delete: msg.key });
        await sock.sendMessage(groupJid, {
          text: `⚠️ @${senderJid.split("@")[0]}, evita spam/flood.`,
          mentions: [senderJid]
        });
        log(`ANTISPAM group=${groupJid} sender=${senderJid} count=${recent.length} repeats=${sameCount}`);
      } catch (err) {
        log(`ANTISPAM_ERROR group=${groupJid} error=${err.message}`);
      }
    }
  }
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  let version;
  try { ({ version } = await fetchLatestBaileysVersion()); }
  catch (err) { log(`Não foi possível consultar a versão do WhatsApp Web: ${err.message}`); }

  const sock = makeWASocket({
    ...(version ? { version } : {}),
    auth: state,
    logger: P({ level: "silent" }),
    browser: ["Bot de Grupos", "Chrome", "1.1.0"],
    markOnlineOnConnect: false,
    syncFullHistory: false,
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 60000
  });

  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log("\n=== QR CODE: WhatsApp > Dispositivos conectados > Conectar dispositivo ===\n");
      qrcode.generate(qr, { small: true });
      log("QR gerado; lê-o no WhatsApp.");
    }
    if (connection === "open") log(`Bot conectado: ${sock.user?.id || "sessão WhatsApp"}`);
    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      log(`Ligação fechada; código=${code}`);
      if (code === DisconnectReason.loggedOut) {
        log("Sessão terminada pelo WhatsApp. Revê a autenticação antes de reiniciar; não apagues auth_info sem saber que vais ter de ligar por QR novamente.");
      } else {
        setTimeout(() => startBot().catch(err => log(`RECONNECT_ERROR ${err.stack || err.message}`)), 5000);
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      try { await handleMessage(sock, msg); }
      catch (err) { log(`MESSAGE_ERROR ${err.stack || err.message}`); }
    }
  });

  sock.ev.on("group-participants.update", async event => {
    if (event.action !== "add") return;
    const settings = getSettings(event.id);
    if (!settings.welcome) return;
    for (const participant of event.participants || []) {
      try {
        const number = participant.split("@")[0];
        await sock.sendMessage(event.id, {
          text: `👋 Bem-vindo(a), @${number}!\n\nLê as regras do grupo e diverte-te por aqui. 😊`,
          mentions: [participant]
        });
        log(`WELCOME group=${event.id} participant=${participant}`);
      } catch (err) {
        log(`WELCOME_ERROR group=${event.id} participant=${participant} error=${err.message}`);
      }
    }
  });
}

process.on("uncaughtException", err => log(`UNCAUGHT_EXCEPTION ${err.stack || err.message}`));
process.on("unhandledRejection", err => log(`UNHANDLED_REJECTION ${err?.stack || err}`));

startBot().catch(err => {
  log(`START_ERROR ${err.stack || err.message}`);
  process.exitCode = 1;
});
