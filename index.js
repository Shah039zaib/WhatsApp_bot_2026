require('dotenv').config();
const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, Browsers, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const axios = require('axios');
const pino = require('pino');
const http = require('http');
const QRCode = require('qrcode');
const fs = require('fs');

let currentQR = null;
let botStatus = 'starting';
const conversationHistory = {};

// ─────────────────────────────────────────
// GROQ + OPENROUTER MODELS LIST
// ─────────────────────────────────────────
const GROQ_MODELS = [
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
    'llama3-70b-8192',
    'llama3-8b-8192',
    'gemma2-9b-it',
    'mixtral-8x7b-32768'
];

const OPENROUTER_MODELS = [
    'meta-llama/llama-3.1-8b-instruct:free',
    'meta-llama/llama-3.2-3b-instruct:free',
    'microsoft/phi-3-mini-128k-instruct:free',
    'google/gemma-2-9b-it:free',
    'mistralai/mistral-7b-instruct:free',
    'openchat/openchat-7b:free'
];

// ─────────────────────────────────────────
// WEB SERVER - QR Show Karne Ke Liye
// ─────────────────────────────────────────
const server = http.createServer(async (req, res) => {
    if (req.url === '/qr') {
        res.writeHead(200, { 'Content-Type': 'text/html' });

        if (botStatus === 'connected') {
            res.end(`
                <html><head><style>
                body{background:#111;color:white;display:flex;flex-direction:column;
                align-items:center;justify-content:center;min-height:100vh;
                font-family:sans-serif;text-align:center;}
                h2{color:#25D366;}
                </style></head>
                <body>
                <h2>✅ Bot Connected!</h2>
                <p>WhatsApp se successfully connect ho gaya!</p>
                <p>Ab apne bot ko message karo!</p>
                </body></html>
            `);
            return;
        }

        if (!currentQR) {
            res.end(`
                <html><head>
                <meta http-equiv="refresh" content="3">
                <style>
                body{background:#111;color:white;display:flex;flex-direction:column;
                align-items:center;justify-content:center;min-height:100vh;
                font-family:sans-serif;text-align:center;}
                h2{color:#f39c12;}
                </style></head>
                <body>
                <h2>⏳ QR Generate Ho Raha Hai...</h2>
                <p>Status: ${botStatus}</p>
                <p>3 second mein auto refresh hoga</p>
                </body></html>
            `);
            return;
        }

        try {
            const qrDataURL = await QRCode.toDataURL(currentQR, { width: 300, margin: 2 });
            res.end(`
                <html><head>
                <meta http-equiv="refresh" content="25">
                <style>
                body{background:#111;color:white;display:flex;flex-direction:column;
                align-items:center;justify-content:center;min-height:100vh;
                font-family:sans-serif;text-align:center;padding:20px;}
                h2{color:#25D366;}
                img{border:8px solid white;border-radius:12px;width:280px;height:280px;}
                .steps{background:#222;padding:15px;border-radius:10px;
                text-align:left;max-width:320px;margin-top:15px;}
                p{color:#aaa;max-width:300px;}
                </style></head>
                <body>
                <h2>📱 WhatsApp QR Code</h2>
                <img src="${qrDataURL}" alt="QR Code"/>
                <div class="steps">
                    <p>1️⃣ WhatsApp kholo</p>
                    <p>2️⃣ 3 dots menu → Linked Devices</p>
                    <p>3️⃣ Link a Device tap karo</p>
                    <p>4️⃣ Yeh QR scan karo</p>
                </div>
                <p style="color:#f39c12;margin-top:15px">
                    ⚠️ QR 25 sec mein expire hoga — jaldi scan karo!
                </p>
                </body></html>
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
// AI FUNCTIONS — SMART FALLBACK
// ─────────────────────────────────────────
async function tryGroqModel(model, userMessage, userId) {
    try {
        if (!conversationHistory[userId]) conversationHistory[userId] = [];
        conversationHistory[userId].push({ role: 'user', content: userMessage });
        if (conversationHistory[userId].length > 20) {
            conversationHistory[userId] = conversationHistory[userId].slice(-20);
        }

        const response = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            {
                model: model,
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
                },
                timeout: 15000
            }
        );

        const assistantMessage = response.data.choices[0].message.content;
        conversationHistory[userId].push({ role: 'assistant', content: assistantMessage });
        console.log(`✅ Groq kaam kiya: ${model}`);
        return assistantMessage;

    } catch (error) {
        console.log(`❌ Groq fail: ${model} — ${error.response?.data?.error?.message || error.message}`);
        if (conversationHistory[userId]) {
            conversationHistory[userId].pop();
        }
        return null;
    }
}

async function tryOpenRouterModel(model, userMessage, userId) {
    try {
        if (!conversationHistory[userId]) conversationHistory[userId] = [];
        conversationHistory[userId].push({ role: 'user', content: userMessage });
        if (conversationHistory[userId].length > 20) {
            conversationHistory[userId] = conversationHistory[userId].slice(-20);
        }

        const response = await axios.post(
            'https://openrouter.ai/api/v1/chat/completions',
            {
                model: model,
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
                },
                timeout: 15000
            }
        );

        const assistantMessage = response.data.choices[0].message.content;
        conversationHistory[userId].push({ role: 'assistant', content: assistantMessage });
        console.log(`✅ OpenRouter kaam kiya: ${model}`);
        return assistantMessage;

    } catch (error) {
        console.log(`❌ OpenRouter fail: ${model} — ${error.response?.data?.error?.message || error.message}`);
        if (conversationHistory[userId]) {
            conversationHistory[userId].pop();
        }
        return null;
    }
}

async function getAIResponse(userMessage, userId) {
    console.log(`🧠 AI response dhund raha hai...`);

    // STEP 1: Sare Groq models try karo
    for (const model of GROQ_MODELS) {
        console.log(`🔄 Groq try: ${model}`);
        const response = await tryGroqModel(model, userMessage, userId);
        if (response) return response;
    }

    console.log('⚠️ Sare Groq models fail — OpenRouter try kar raha hai...');

    // STEP 2: Sare OpenRouter models try karo
    for (const model of OPENROUTER_MODELS) {
        console.log(`🔄 OpenRouter try: ${model}`);
        const response = await tryOpenRouterModel(model, userMessage, userId);
        if (response) return response;
    }

    // STEP 3: Sab fail
    console.log('❌ Sare models fail!');
    return '⚠️ Abhi AI service thodi busy hai. 1-2 minute baad dobara try karo!';
}

// ─────────────────────────────────────────
// WHATSAPP BOT — STRONG LOGIC
// ─────────────────────────────────────────
async function startBot() {
    try {
        const { version, isLatest } = await fetchLatestBaileysVersion();
        console.log(`📱 WA Version: ${version.join('.')} — Latest: ${isLatest}`);

        const { state, saveCreds } = await useMultiFileAuthState('/tmp/auth_info');

        const sock = makeWASocket({
            version,
            auth: state,
            logger: pino({ level: 'silent' }),
            browser: Browsers.ubuntu('Chrome'),
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 60000,
            keepAliveIntervalMs: 30000,
            emitOwnEvents: false,
            markOnlineOnConnect: false,
            generateHighQualityLinkPreview: false,
            qrTimeout: 60000,
            retryRequestDelayMs: 2000,
            maxMsgRetryCount: 5,
            fireInitQueries: true,
            syncFullHistory: false
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                currentQR = qr;
                botStatus = 'qr_ready';
                console.log('✅ QR ready! /qr page pe jao!');
            }

            if (connection === 'close') {
                currentQR = null;
                const code = lastDisconnect?.error?.output?.statusCode;
                console.log('❌ Connection band hua, code:', code);

                if (code === DisconnectReason.loggedOut) {
                    botStatus = 'logged_out';
                    console.log('🚪 Logged out — auth delete karke restart...');
                    try {
                        fs.rmSync('/tmp/auth_info', { recursive: true, force: true });
                    } catch (e) {}
                    setTimeout(startBot, 5000);
                } else {
                    botStatus = 'reconnecting';
                    const delay = code === 405 ? 15000 : 10000;
                    console.log(`🔄 ${delay / 1000} sec mein reconnect...`);
                    setTimeout(startBot, delay);
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
                            text: `🤖 *${process.env.BOT_NAME}*\n\n` +
                                  `• Koi bhi sawaal pucho\n` +
                                  `• *!reset* - Conversation clear\n` +
                                  `• *!help* - Help dekho\n` +
                                  `• *!provider* - AI info`
                        });
                        continue;
                    }

                    if (userMessage.toLowerCase() === '!provider') {
                        await sock.sendMessage(senderId, {
                            text: `🧠 Active Provider: *${process.env.AI_PROVIDER}*\n` +
                                  `📊 Groq Models: *${GROQ_MODELS.length}*\n` +
                                  `📊 OpenRouter Models: *${OPENROUTER_MODELS.length}*\n` +
                                  `✅ Auto fallback: ON`
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
        console.error('Bot start error:', err.message);
        console.log('🔄 15 sec mein restart...');
        setTimeout(startBot, 15000);
    }
}

console.log('🚀 WhatsApp AI Bot start ho raha hai...');
startBot();
