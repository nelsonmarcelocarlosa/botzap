const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: true // Mostra o QR Code no terminal da hospedagem
    });

    sock.ev.on('creds.update', saveCreds);

    // Conexão e Reconexão Automática
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom) ? 
                lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut : true;
            console.log('Conexão fechada. Reconectando...', shouldReconnect);
            if (shouldReconnect) connectToWhatsApp();
        } else if (connection === 'open') {
            console.log('Bot conectado com sucesso!');
        }
    });

    // 1. Sistema de Boas-Vindas
    sock.ev.on('group-participants.update', async (anu) => {
        if (anu.action === 'add') {
            for (let num of anu.participants) {
                await sock.sendMessage(anu.id, { 
                    text: `Olá, @${num.split('@')[0]}! Seja muito bem-vindo(a) ao grupo! 👋`,
                    mentions: [num]
                });
            }
        }
    });

    // 2. Comandos do Bot
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const isGroup = from.endsWith('@g.us');
        if (!isGroup) return; // O bot só responde em grupos

        const type = Object.keys(msg.message)[0];
        const body = (type === 'conversation') ? msg.message.conversation : 
                     (type === 'extendedTextMessage') ? msg.message.extendedTextMessage.text : '';
        
        const prefix = '!'; // Prefixo dos comandos
        if (!body.startsWith(prefix)) return;

        const args = body.trim().split(/ +/).slice(1);
        const command = body.slice(prefix.length).trim().split(/ +/).shift().toLowerCase();

        // Verificar se quem enviou o comando é admin (Necessário para segurança)
        const groupMetadata = await sock.groupMetadata(from);
        const participants = groupMetadata.participants;
        const sender = msg.key.participant || msg.key.fromMe ? sock.user.id : '';
        const isAdmin = participants.find(p => p.id === sender)?.admin !== null;

        if (!isAdmin) return; // Se não for admin, o bot ignora o comando

        switch (command) {
            case 'banir':
                // Comando: !banir @usuario ou mencionando uma mensagem
                let userToBan = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || 
                                msg.message.extendedTextMessage?.contextInfo?.participant;
                if (!userToBan && args[0]) userToBan = args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                
                if (userToBan) {
                    await sock.groupParticipantsUpdate(from, [userToBan], 'remove');
                    await sock.sendMessage(from, { text: 'Membro banido com sucesso.' });
                } else {
                    await sock.sendMessage(from, { text: 'Marque o usuário ou responda à mensagem dele para banir.' });
                }
                break;

            case 'adicionar':
                // Comando: !adicionar 5511999999999
                if (!args[0]) return sock.sendMessage(from, { text: 'Digite o número com o código do país. Ex: !adicionar 5511999999999' });
                const userToAdd = args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                await sock.groupParticipantsUpdate(from, [userToAdd], 'add');
                await sock.sendMessage(from, { text: 'Tentando adicionar membro...' });
                break;

            case 'fechar':
                // Comando: !fechar grupo (Apenas admins enviam mensagens)
                await sock.groupSettingUpdate(from, 'announcement');
                await sock.sendMessage(from, { text: 'Grupo fechado! Apenas administradores podem enviar mensagens.' });
                break;

            case 'abrir':
                // Comando: !abrir grupo (Todos enviam mensagens)
                await sock.groupSettingUpdate(from, 'not_announcement');
                await sock.sendMessage(from, { text: 'Grupo aberto! Todos os membros podem enviar mensagens.' });
                break;
        }
    });
}

connectToWhatsApp();
