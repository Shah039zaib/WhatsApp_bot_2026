require('dotenv').config();
const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const axios = require('axios');
const qrcode = require('qrcode-terminal');
const pino = require('pino');

// ─────────────────────────────────────────
// AI PROVIDER FUNCTIONS
// ─────────────────────────────────────────

// Conversation history store karne ke liye
const conversationHistory = {};

// Groq AI se response lena
async function getGroqResponse(userMessage, userId) {
    try {
        // User ki history initialize karo
        if (!conversationHistory[userId]) {
            conversationHistory[userId] = [];
        }

        // User message history mein add karo
        conversationHistory[userId].push({
            role: 'user',
            content: userMessage
        });

        // Last 10 messages rakho memory mein
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
                        content: `Tum ek helpful AI assistant ho jiska naam ${process.env.BOT_NAME} hai. Tum WhatsApp pe log ki madad karte ho. Short aur clear replies do.`
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

        // Assistant reply bhi history mein add karo
        conversationHistory[userId].push({
            role: 'assistant',
            content: assistantMessage
        });

        return assistantMessage;

    } catch (error) {
        console.error('Groq Error:', error.response?.data || error.message);
        return '❌ Groq AI se connect nahi ho saka. Thodi der baad try karo.';
    }
}

// OpenRouter AI se response lena
async function getOpenRouterResponse(userMessage, userId) {
    try {
        if (!conversationHistory[userId]) {
            conversationHistory[userId] = [];
        }

        conversationHistory[userId].push({
            role: 'user',
            content: userMessage
        });

        if (conversationHistory[userId].length > 20) {
            conversationHistory[userId] = conversationHistory[userId].slice(-20);
        }

        const response = await axios.post(
            'https://openrouter.ai/api/v1/chat/completions',
            {
                // Free model - OpenRouter pe available
                model: 'meta-llama/llama-3.1-8b-instruct:free',
                messages: [
                    {
                        role: 'system',
                        content: `Tum ek helpful AI assistant ho jiska naam ${process.env.BOT_NAME} hai. Tum WhatsApp pe log ki madad karte ho. Short aur clear replies do.`
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

        conversationHistory[userId].push({
            role: 'assistant',
            content: assistantMessage
        });

        return assistantMessage;

    } catch (error) {
        console.error('OpenRouter Error:', error.response?.data || error.message);
        return '❌ OpenRouter AI se connect nahi ho saka. Thodi der baad try karo.';
    }
}

// Main AI function - provider ke hisaab se call karo
async function getAIResponse(userMessage, userId) {
    const provider = process.env.AI_PROVIDER || 'groq';

    if (provider === 'openrouter') {
        return await getOpenRouterResponse(userMessage, userId);
    } else {
        return await getGroqResponse(userMessage, userId);
    }
}

// ─────────────────────────────────────────
// WHATSAPP BOT
// ─────────────────────────────────────────

async function startBot() {
    // Auth state save karna
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');

    // Socket banao
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' })
    });

    // Credentials save karo
    sock.ev.on('creds.update', saveCreds);

    // Connection handle karo
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        // QR code show karo
        if (qr) {
            console.log('\n📱 WhatsApp se connect karne ke liye QR scan karo:\n');
            qrcode.generate(qr, { small: true });
            console.log('\n⏳ QR scan karo apne WhatsApp se...\n');
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;

            console.log('❌ Connection band hua. Reconnect:', shouldReconnect);

            if (shouldReconnect) {
                console.log('🔄 5 second mein reconnect ho raha hai...');
                setTimeout(startBot, 5000);
            } else {
                console.log('🚪 Logged out. Auth folder delete karo aur dobara run karo.');
            }
        }

        if (connection === 'open') {
            console.log('✅ WhatsApp se successfully connect ho gaya!');
            console.log(`🤖 Bot Name: ${process.env.BOT_NAME}`);
            console.log(`🧠 AI Provider: ${process.env.AI_PROVIDER}`);
            console.log('📨 Messages sun raha hai...\n');
        }
    });

    // Messages handle karo
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const message of messages) {
            try {
                // Apne messages ignore karo
                if (message.key.fromMe) continue;

                // Message text nikalo
                const userMessage =
                    message.message?.conversation ||
                    message.message?.extendedTextMessage?.text ||
                    '';

                // Empty message ignore karo
                if (!userMessage.trim()) continue;

                // Sender ID nikalo
                const senderId = message.key.remoteJid;
                const senderName = message.pushName || 'User';

                console.log(`📩 Message from ${senderName}: ${userMessage}`);

                // Special commands handle karo
                if (userMessage.toLowerCase() === '!reset') {
                    conversationHistory[senderId] = [];
                    await sock.sendMessage(senderId, {
                        text: '🔄 Conversation reset ho gayi! Ab nayi baat shuru karo.'
                    });
                    continue;
                }

                if (userMessage.toLowerCase() === '!help') {
                    await sock.sendMessage(senderId, {
                        text: `🤖 *${process.env.BOT_NAME} Help*\n\n` +
                              `• Koi bhi sawaal pucho — AI jawab dega\n` +
                              `• *!reset* — Conversation clear karo\n` +
                              `• *!provider* — Current AI provider dekho\n` +
                              `• *!help* — Yeh message dekho\n\n` +
                              `_Powered by ${process.env.AI_PROVIDER === 'openrouter' ? 'OpenRouter' : 'Groq'} AI_`
                    });
                    continue;
                }

                if (userMessage.toLowerCase() === '!provider') {
                    await sock.sendMessage(senderId, {
                        text: `🧠 Current AI Provider: *${process.env.AI_PROVIDER}*\n` +
                              `📊 Model: *${process.env.AI_PROVIDER === 'openrouter' ? 'Llama 3.1 8B (Free)' : 'Llama 3 70B (Free)'}*`
                    });
                    continue;
                }

                // Typing indicator show karo
                await sock.sendPresenceUpdate('composing', senderId);

                // AI se response lo
                const aiResponse = await getAIResponse(userMessage, senderId);

                // Typing band karo
                await sock.sendPresenceUpdate('paused', senderId);

                // Reply bhejo
                await sock.sendMessage(senderId, {
                    text: aiResponse
                }, { quoted: message });

                console.log(`✅ Reply sent to ${senderName}`);

            } catch (error) {
                console.error('Message handle karne mein error:', error);
            }
        }
    });
}

// Bot start karo
console.log('🚀 WhatsApp AI Bot start ho raha hai...');
startBot();
