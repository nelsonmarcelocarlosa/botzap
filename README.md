# Bot WhatsApp para Render (Background Worker)

## Configuração recomendada
- Tipo: **Background Worker** (não Web Service).
- Runtime: Node.js.
- Build Command: `npm install`
- Start Command: `npm start`
- Node.js: 20 ou superior.
- Persistent Disk: mount path `/var/data`, tamanho inicial `1 GB`.
- Environment Variable: `DATA_DIR=/var/data`.

O ficheiro `render.yaml` contém uma configuração Blueprint para criar o worker, as variáveis e o disco. Guarda este projeto num repositório GitHub, depois no Render escolhe **New + > Blueprint** e liga o repositório.

**Nota de custo:** os discos persistentes do Render exigem um serviço pago compatível. Um worker sem disco tem filesystem efémero; a pasta `auth_info/` pode desaparecer em reinícios/deploys e exigir novo QR. Confirma os preços e as condições atuais do teu plano Render.

## Deploy pelo Dashboard (sem Blueprint)
1. Envia os ficheiros para um repositório GitHub.
2. No Render, seleciona **New + > Background Worker** e liga o repositório.
3. Configura:
   - Runtime: Node
   - Build Command: `npm install`
   - Start Command: `npm start`
4. Em Environment, adiciona `DATA_DIR` com valor `/var/data`.
5. Em Disks, adiciona um disco persistente:
   - Mount Path: `/var/data`
   - Size: `1 GB`
6. Guarda e faz deploy.
7. Abre a página **Logs** do serviço. O bot deverá imprimir o QR Code ASCII quando a ligação precisar de autenticação.
8. No WhatsApp do número do bot, abre **Dispositivos conectados > Conectar dispositivo** e lê o QR Code.
9. Confirma nos logs a mensagem `Bot conectado`.
10. Adiciona o bot ao grupo e promove-o a administrador.

## Sessão e armazenamento
O bot grava a sessão em `/var/data/auth_info` e os logs em `/var/data/logs/bot.log`. O disco tem de estar montado em `/var/data`; caso contrário, esses dados não ficam protegidos de reinícios/deploys. Não partilhes nem publiques `auth_info`, porque contém credenciais da sessão.

## Comandos
- `!menu`
- `!ban @membro` (ou responde à mensagem do membro)
- `!add 258XXXXXXXXX`
- `!close`
- `!open`
- `!welcome on` / `!welcome off`
- `!antilink on` / `!antilink off`
- `!antispam on` / `!antispam off`
- `!id`

Os comandos de administração só são aceites de administradores do grupo. O bot também precisa de ser administrador para executar ações de moderação. Adicionar membros depende das regras atuais do WhatsApp e pode exigir convite.

## QR Code não aparece?
- Consulta **Logs** e confirma que o processo arrancou com `npm start`.
- Se a sessão já estiver guardada no disco, não é necessário novo QR; procura `Bot conectado`.
- Se o WhatsApp tiver terminado a sessão, o bot pode não gerar QR automaticamente. Verifica o erro nos logs antes de remover a pasta `auth_info`.
- Nunca publiques o QR nem a pasta `auth_info`; quem obtiver acesso pode controlar a sessão vinculada.

## Limitações
Baileys é uma biblioteca não oficial baseada no protocolo WhatsApp Web. O WhatsApp pode alterar o protocolo, desconectar a sessão ou restringir a conta. Anti-link e anti-spam são regras básicas, por isso testa primeiro num grupo privado.
