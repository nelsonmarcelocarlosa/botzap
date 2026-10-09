const { default: makeWASocket, useMultiFileAuthState, makeCacheableSignalKeyStore } = require('@whiskeysockets/baileys')
const pino = require('pino')

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth')

  const sock = makeWASocket({
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino().child({ level: 'silent' }))
    },
    logger: pino({ level: 'silent' }),
    printQRInTerminal: true,
    browser: ['Bot Matola', 'Chrome', '1.0.0']
  })

  if (!sock.authState.creds.registered) {
    const numeroBot = '258864590247'
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(numeroBot)
        console.log('===========================')
        console.log('CODIGO DE PAREAMENTO: ' + code)
        console.log('===========================')
      } catch (e) {
        console.log('Erro ao gerar codigo', e)
      }
    }, 4000)
  }

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', (update) => {
    if (update.connection === 'open') {
      console.log('BOT ONLINE COM SUCESSO')
    }
  })

  sock.ev.on('messages.upsert', async ({ messages }) => {
    try {
      const msg = messages[0]
      if (!msg.message) return
      if (!msg.key.remoteJid.includes('@g.us')) return

      const jidGrupo = msg.key.remoteJid
      const texto = msg.message.conversation || msg.message.extendedTextMessage?.text || ''
      const mencionados = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || []

      if (!texto.startsWith('!')) return

      const metadata = await sock.groupMetadata(jidGrupo)
      const sender = msg.key.participant
      const isSenderAdmin = metadata.participants.find(p => p.id === sender)?.admin

      if (!isSenderAdmin) {
        return
      }

      if (texto === '!fechar') {
        await sock.groupSettingUpdate(jidGrupo, 'announcement')
        await sock.sendMessage(jidGrupo, { text: 'Grupo fechado - so ADM fala' })
      }
