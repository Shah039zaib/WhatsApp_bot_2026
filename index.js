require('dotenv').config();
const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const axios = require('axios');
const pino = require('pino');
const http = require('http');
const QRCode = require('qrcode');

let currentQR = null;
let botStatus = 'starting';
const conversationHistory = {};

// ─────────────────────────────────────────
// WEB SERVER
// ─────────────────────────────────────────
const server = http.createServer(async (req, res) => {
    if (req.url === '/qr') {
        res.writeHead(200, { 'Content-Type': 'text/html' });

        if (botStatus === 'connected') {
            res.end(`
                <html>
                <head>
                    <style>
                        body{background:#111;color:white;display:flex;flex-direction:column;
                        align-items:center;justify-content:center;min-height:100vh;
                        font-family:sans-serif;text-align:center;}
                        h2{color:#25D366;}
                    </style>
                </head>
                <body>
                    <h2>✅ Bot Connected!</h2>
                    <p>WhatsApp se successfully connect ho gaya!</p>
                    <p>Ab apne bot ko message karo!</p>
                </body>
                </html>
            `);
            return;
        }

        if (!currentQR) {
            res.end(`
                <html>
                <head>
                    <meta http-equiv="refresh" content="3">
                    <style>
                        body{background:#111;color:white;display:flex;flex-direction:column;
                        align-items:center;justify-content:center;min-height:100vh;
                        font-family:sans-serif;text-align:center;}
                        h2{color:#f39c12;}
                    </style>
                </head>
                <body>
                    <h2>⏳ QR Generate Ho Raha Hai...</h2>
                    <p>Status: ${botStatus}</p>
                    <p>3 second mein auto refresh hoga</p>
                </body>
                </html>
            `);
            return;
        }

        try {
            const qrDataURL = await QRCode.toDataURL(currentQR, { 
                width: 300,
                margin: 2 
            });
            res.end(`
                <html>
                <head>
                    <meta http-equiv="refresh" content="30">
                    <style>
                        body{background:#111;color:white;display:flex;flex-direction:column;
                        align-items:center;justify-content:center;min-height:100vh;
                        font-family:sans-serif;text-align:center;padding:20px;}
                        h2{color:#25D366;}
                        img{border:8px solid white;border-radius:12px;width:280px;height:280px;}
                        p{color:#aaa;max-width:300px;}
                        .steps{background:#222;padding:15px;border-radius:10px;
                        text-align:left;max-width:320px;margin-top:15px;}
                    </style>
                </head>
                <body>
                    <h2>📱 WhatsApp QR Code</h2>
                    <img src="${qrDataURL}" alt="QR Code"/>
                    <div class="steps">
                        <p>1️⃣ WhatsApp kholo</p>
                        <p>2️⃣ 3 dots → Linked Devices</p>
                        <p>3️⃣ Link a Device tap karo</p>
                        <p>4️⃣ Yeh QR scan karo</p>
                    </div>
                    <p style="color:#f39c12;margin-top:15px">⚠️ QR 30 sec mein expire hoga — jaldi scan karo!</p>
                </body>
                </html>
            `);
        } catch (err) {
            res.end('<h1 style="color:red">QR Error: ' + err.message + '</h1>');
        }

    } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
            status: botStatus,
            hasQR: !!currentQR,
            qrUrl: '/qr'
        }));
    }
});

server.listen(process.env.PORT || 3000, () => {
    console.log('🌐 Web server chalu hai!');
    console.log('📱 QR ke liye /qr page kholo!');
});

// ─────────────────────────────────────────
// AI FUNCTIONS
// ─────────────────────────────────────────
async function getGroqResponse(userMessage, userId) {
    try {
        if (!conversationHistory[userId]) conversationHistory[userId] = [];
        conversationHistory[userId].push({ role: 'user', content: userMessage });
        if (conversationHistory[userId].length > 20) {
            conversationHistory[userId] = conversationHistory[userId].slice(-20);
        }

        const response = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            {
                model: 'llama3-70b-8192',
                messages: [
                    {
                        role: 'system',
                        content: `Tum ek helpful AI assistant ho jiska naam ${process.env.BOT_NAME} hai. Short aur clear replies do.`
                    },
                    ...conversationHistory[userId]
                ],
                max_tokens: 1024,
                temperature: 0.7
            },
            {
                headers: {
                    'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        const assistantMessage = response.data.choices[0].message.content;
        conversationHistory[userId].push({ role: 'assistant', content: assistantMessage });
        return assistantMessage;

    } catch (error) {
        console.error('Groq Error:', error.response?.data || error.message);
        return '❌ AI se connect nahi ho saka. Thodi der baad try karo.';
    }
}

async function getOpenRouterResponse(userMessage, userId) {
    try {
        if (!conversationHistory[userId]) conversationHistory[userId] = [];
        conversationHistory[userId].push({ role: 'user', content: userMessage });
        if (conversationHistory[userId].length > 20) {
            conversationHistory[userId] = conversationHistory[userId].slice(-20);
        }

        const response = await axios.post(
            'https://openrouter.ai/api/v1/chat/completions',
            {
                model: 'meta-llama/llama-3.1-8b-instruct:free',
                messages: [
                    {
                        role: 'system',
                        content: `Tum ek helpful AI assistant ho jiska naam ${process.env.BOT_NAME} hai. Short aur clear replies do.`
                    },
                    ...conversationHistory[userId]
                ],
                max_tokens: 1024,
                temperature: 0.7
            },
            {
                headers: {
                    'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'https://github.com/whatsapp-ai-bot',
                    'X-Title': 'WhatsApp AI Bot'
                }
            }
        );

        const assistantMessage = response.data.choices[0].message.content;
        conversationHistory[userId].push({ role: 'assistant', content: assistantMessage });
        return assistantMessage;

    } catch (error) {
        console.error('OpenRouter Error:', error.response?.data || error.message);
        return '❌ AI se connect nahi ho saka. Thodi der baad try karo.';
    }
}

async function getAIResponse(userMessage, userId) {
    const provider = process.env.AI_PROVIDER || 'groq';
    if (provider === 'openrouter') return await getOpenRouterResponse(userMessage, userId);
    return await getGroqResponse(userMessage, userId);
}

// ─────────────────────────────────────────
// WHATSAPP BOT
// ─────────────────────────────────────────
async function startBot() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState('/tmp/auth_info');

        const sock = makeWASocket({
            auth: state,
            logger: pino({ level: 'silent' }),
            browser: ['WhatsApp Bot', 'Chrome', '1.0.0'],
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 60000,
            keepAliveIntervalMs: 10000,
            emitOwnEvents: false,
            markOnlineOnConnect: false
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                currentQR = qr;
                botStatus = 'qr_ready';
                console.log('✅ QR ready! /qr page pe jao scan karne ke liye!');
            }

            if (connection === 'close') {
                currentQR = null;
                const code = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = code !== DisconnectReason.loggedOut;
                botStatus = shouldReconnect ? 'reconnecting' : 'logged_out';
                console.log('❌ Connection band hua, code:', code);
                if (shouldReconnect) {
                    console.log('🔄 10 second mein reconnect...');
                    setTimeout(startBot, 10000);
                }
            }

            if (connection === 'open') {
                currentQR = null;
                botStatus = 'connected';
                console.log('✅ WhatsApp connected!');
                console.log('🤖 Bot:', process.env.BOT_NAME);
                console.log('🧠 AI:', process.env.AI_PROVIDER);
            }
        });

        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type !== 'notify') return;

            for (const message of messages) {
                try {
                    if (message.key.fromMe) continue;

                    const userMessage =
                        message.message?.conversation ||
                        message.message?.extendedTextMessage?.text || '';

                    if (!userMessage.trim()) continue;

                    const senderId = message.key.remoteJid;
                    const senderName = message.pushName || 'User';
                    console.log(`📩 ${senderName}: ${userMessage}`);

                    if (userMessage.toLowerCase() === '!reset') {
                        conversationHistory[senderId] = [];
                        await sock.sendMessage(senderId, { text: '🔄 Conversation reset!' });
                        continue;
                    }

                    if (userMessage.toLowerCase() === '!help') {
                        await sock.sendMessage(senderId, {
                            text: `🤖 *${process.env.BOT_NAME}*\n\n• Koi bhi sawaal pucho\n• *!reset* - Conversation clear\n• *!help* - Help dekho\n• *!provider* - AI info`
                        });
                        continue;
                    }

                    if (userMessage.toLowerCase() === '!provider') {
                        await sock.sendMessage(senderId, {
                            text: `🧠 Provider: *${process.env.AI_PROVIDER}*`
                        });
                        continue;
                    }

                    await sock.sendPresenceUpdate('composing', senderId);
                    const aiResponse = await getAIResponse(userMessage, senderId);
                    await sock.sendPresenceUpdate('paused', senderId);
                    await sock.sendMessage(senderId, { text: aiResponse }, { quoted: message });
                    console.log(`✅ Reply sent to ${senderName}`);

                } catch (err) {
                    console.error('Message error:', err);
                }
            }
        });

    } catch (err) {
        console.error('Bot start error:', err);
        setTimeout(startBot, 10000);
    }
}

console.log('🚀 WhatsApp AI Bot start ho raha hai...');
startBot();
