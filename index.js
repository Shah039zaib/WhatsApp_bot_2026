require('dotenv').config();
const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const axios = require('axios');
const pino = require('pino');
const http = require('http');
const fs = require('fs');
const qrcode = require('qrcode');

// Global QR store
let currentQR = null;
let botStatus = 'waiting';
const conversationHistory = {};

// ─────────────────────────────────────────
// WEB SERVER - QR Show Karne Ke Liye
// ─────────────────────────────────────────
const server = http.createServer(async (req, res) => {
    if (req.url === '/qr') {
        if (currentQR) {
            try {
                const qrImage = await qrcode.toDataURL(currentQR);
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(`
                    <html>
                    <head>
                        <title>WhatsApp Bot QR</title>
                        <meta http-equiv="refresh" content="10">
                        <style>
                            body { 
                                display:flex; 
                                flex-direction:column;
                                align-items:center; 
                                justify-content:center;
                                min-height:100vh;
                                margin:0;
                                background:#111;
                                color:white;
                                font-family:sans-serif;
                            }
                            img { 
                                width:300px; 
                                height:300px;
                                border:10px solid white;
                                border-radius:10px;
                            }
                            h2 { color:#25D366; }
                            p { color:#aaa; }
                        </style>
                    </head>
                    <body>
                        <h2>📱 WhatsApp Bot QR Code</h2>
                        <img src="${qrImage}" alt="QR Code"/>
                        <p>WhatsApp → Linked Devices → Link a Device → Scan karo</p>
                        <p style="color:#f39c12">Page har 10 second mein refresh hoga</p>
                    </body>
                    </html>
                `);
            } catch (e) {
                res.writeHead(500);
                res.end('QR generate karne mein error');
            }
        } else {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
                <html>
                <head>
                    <meta http-equiv="refresh" content="5">
                    <style>
                        body {
                            display:flex;
                            flex-direction:column;
                            align-items:center;
                            justify-content:center;
                            min-height:100vh;
                            margin:0;
                            background:#111;
                            color:white;
                            font-family:sans-serif;
                        }
                        h2 { color:#25D366; }
                    </style>
                </head>
                <body>
                    <h2>⏳ Bot Status: ${botStatus}</h2>
                    <p>${botStatus === 'connected' ? '✅ WhatsApp se connect ho gaya!' : '🔄 QR generate ho raha hai... 5 second mein refresh hoga'}</p>
                </body>
                </html>
            `);
        }
    } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
            status: botStatus,
            message: botStatus === 'connected' ? 'Bot is running!' : 'Visit /qr to scan QR code'
        }));
    }
});

server.listen(process.env.PORT || 3000, () => {
    console.log(`🌐 Web server chalu hai`);
    console.log(`📱 QR dekhne ke liye /qr page kholo Render URL pe`);
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
    if (provider === 'openrouter') {
        return await getOpenRouterResponse(userMessage, userId);
    }
    return await getGroqResponse(userMessage, userId);
}

// ─────────────────────────────────────────
// WHATSAPP BOT
// ─────────────────────────────────────────
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            currentQR = qr;
            botStatus = 'qr_ready';
            console.log('📱 QR ready! Render URL ke baad /qr lagao aur scan karo');
        }

        if (connection === 'close') {
            currentQR = null;
            botStatus = 'reconnecting';
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('❌ Connection band hua. Reconnect:', shouldReconnect);
            if (shouldReconnect) {
                setTimeout(startBot, 5000);
            }
        }

        if (connection === 'open') {
            currentQR = null;
            botStatus = 'connected';
            console.log('✅ WhatsApp se connect ho gaya!');
            console.log(`🤖 Bot: ${process.env.BOT_NAME}`);
            console.log(`🧠 AI: ${process.env.AI_PROVIDER}`);
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
                        text: `🤖 *${process.env.BOT_NAME}*\n\n• Koi bhi sawaal pucho\n• *!reset* - Conversation clear\n• *!help* - Help\n• *!provider* - AI info`
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

            } catch (error) {
                console.error('Error:', error);
            }
        }
    });
}

console.log('🚀 WhatsApp AI Bot start ho raha hai...');
startBot();
