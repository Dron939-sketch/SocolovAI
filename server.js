// ============================================
// СОКОЛОВ AI - СЕРВЕРНАЯ ЧАСТЬ
// Исправленная версия для Render
// ============================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const multer = require('multer');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Создаем папку для загрузок
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}
const upload = multer({ dest: uploadDir });

// ============================================
// MIDDLEWARE
// ============================================

// CORS - важно для API запросов
app.use(cors({
    origin: '*', // Для разработки, в production ограничьте
    credentials: true
}));

// Парсеры
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Статические файлы
app.use(express.static(path.join(__dirname, 'public')));

// ============================================
// ХРАНИЛИЩЕ СЕССИЙ
// ============================================

const sessions = new Map();

function getSession(sessionId) {
    if (!sessions.has(sessionId)) {
        sessions.set(sessionId, {
            id: sessionId,
            messages: [],
            createdAt: new Date(),
            lastActivity: new Date()
        });
    }
    const session = sessions.get(sessionId);
    session.lastActivity = new Date();
    return session;
}

// ============================================
// API ENDPOINTS (ДОЛЖНЫ БЫТЬ ДО СТАТИКИ)
// ============================================

// Health check
app.get('/api/health', (req, res) => {
    console.log('✅ Health check called');
    res.json({
        status: 'ok',
        name: 'Соколов AI',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        sessions: sessions.size
    });
});

// Создать новую сессию
app.post('/api/session', (req, res) => {
    console.log('📝 Creating new session');
    const sessionId = uuidv4();
    const session = {
        id: sessionId,
        messages: [],
        createdAt: new Date(),
        lastActivity: new Date()
    };
    sessions.set(sessionId, session);
    res.json({ 
        sessionId, 
        createdAt: session.createdAt,
        message: 'Session created'
    });
});

// Получить историю чата
app.get('/api/chat/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    console.log(`📖 Getting chat history for ${sessionId}`);
    
    if (!sessions.has(sessionId)) {
        return res.json({ messages: [] });
    }
    
    const session = getSession(sessionId);
    res.json({ messages: session.messages });
});

// Отправить сообщение
app.post('/api/chat/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    const { message, model = 'deepseek-chat', temperature = 0.7 } = req.body;
    
    console.log(`💬 Received message for ${sessionId}: ${message?.substring(0, 50)}...`);
    
    if (!message || message.trim() === '') {
        return res.status(400).json({ error: 'Сообщение не может быть пустым' });
    }
    
    const session = getSession(sessionId);
    
    // Добавляем сообщение пользователя
    const userMessage = {
        id: uuidv4(),
        role: 'user',
        content: message,
        timestamp: new Date().toISOString()
    };
    session.messages.push(userMessage);
    
    // Если нет API ключа, возвращаем заглушку
    if (!process.env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY === 'your_api_key_here') {
        const mockResponse = `🦅 **Соколов AI** отвечает:\n\nВы написали: "${message}"\n\n⚠️ **Внимание:** API ключ DeepSeek не настроен. Добавьте переменную окружения DEEPSEEK_API_KEY в настройках Render.\n\nПример ответа AI: Это тестовый режим. После настройки API ключа я буду давать полноценные ответы.`;
        
        const aiMessage = {
            id: uuidv4(),
            role: 'assistant',
            content: mockResponse,
            timestamp: new Date().toISOString()
        };
        session.messages.push(aiMessage);
        
        return res.json({ message: aiMessage });
    }
    
    // Формируем запрос к DeepSeek
    const messages = [
        { role: 'system', content: process.env.SYSTEM_PROMPT || 'Ты — Соколов AI, полезный помощник. Отвечай на русском языке.' },
        ...session.messages.map(m => ({ role: m.role, content: m.content }))
    ];
    
    try {
        const response = await axios.post('https://api.deepseek.com/v1/chat/completions', {
            model: model,
            messages: messages,
            max_tokens: 4096,
            temperature: temperature
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 60000
        });
        
        const aiResponse = response.data.choices[0].message.content;
        
        const aiMessage = {
            id: uuidv4(),
            role: 'assistant',
            content: aiResponse,
            timestamp: new Date().toISOString(),
            usage: response.data.usage
        };
        session.messages.push(aiMessage);
        
        res.json({ message: aiMessage, usage: response.data.usage });
        
    } catch (error) {
        console.error('DeepSeek API error:', error.response?.data || error.message);
        
        const errorMessage = {
            id: uuidv4(),
            role: 'assistant',
            content: `⚠️ **Ошибка API:** ${error.response?.data?.error?.message || error.message}\n\nПроверьте настройки API ключа в переменных окружения Render.`,
            timestamp: new Date().toISOString(),
            isError: true
        };
        session.messages.push(errorMessage);
        
        res.status(500).json({ error: 'Ошибка при обращении к AI', message: errorMessage });
    }
});

// Потоковая передача
app.post('/api/chat/:sessionId/stream', async (req, res) => {
    const { sessionId } = req.params;
    const { message, model = 'deepseek-chat', temperature = 0.7 } = req.body;
    
    console.log(`📡 Stream request for ${sessionId}`);
    
    if (!message || message.trim() === '') {
        return res.status(400).json({ error: 'Сообщение не может быть пустым' });
    }
    
    const session = getSession(sessionId);
    
    const userMessage = {
        id: uuidv4(),
        role: 'user',
        content: message,
        timestamp: new Date().toISOString()
    };
    session.messages.push(userMessage);
    
    // SSE Headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    // Если нет API ключа
    if (!process.env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY === 'your_api_key_here') {
        const mockResponse = `🦅 **Соколов AI** отвечает:\n\nВы написали: "${message}"\n\n⚠️ **API ключ не настроен.** Добавьте DEEPSEEK_API_KEY в переменные окружения.`;
        
        for (let i = 0; i < mockResponse.length; i++) {
            res.write(`data: ${JSON.stringify({ content: mockResponse[i], done: false })}\n\n`);
            await new Promise(r => setTimeout(r, 10));
        }
        res.write(`event: done\ndata: ${JSON.stringify({ fullResponse: mockResponse })}\n\n`);
        res.end();
        return;
    }
    
    const messages = [
        { role: 'system', content: process.env.SYSTEM_PROMPT || 'Ты — Соколов AI, полезный помощник. Отвечай на русском языке.' },
        ...session.messages.map(m => ({ role: m.role, content: m.content }))
    ];
    
    try {
        const response = await axios.post('https://api.deepseek.com/v1/chat/completions', {
            model: model,
            messages: messages,
            max_tokens: 4096,
            temperature: temperature,
            stream: true
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
                'Content-Type': 'application/json'
            },
            responseType: 'stream',
            timeout: 120000
        });
        
        let fullResponse = '';
        
        response.data.on('data', (chunk) => {
            const lines = chunk.toString().split('\n');
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6);
                    if (data === '[DONE]') {
                        const aiMessage = {
                            id: uuidv4(),
                            role: 'assistant',
                            content: fullResponse,
                            timestamp: new Date().toISOString()
                        };
                        session.messages.push(aiMessage);
                        res.write(`event: done\ndata: ${JSON.stringify({ fullResponse })}\n\n`);
                        res.end();
                        return;
                    }
                    try {
                        const parsed = JSON.parse(data);
                        const content = parsed.choices[0]?.delta?.content || '';
                        if (content) {
                            fullResponse += content;
                            res.write(`data: ${JSON.stringify({ content, done: false })}\n\n`);
                        }
                    } catch (e) {}
                }
            }
        });
        
        response.data.on('error', (error) => {
            console.error('Stream error:', error);
            res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
            res.end();
        });
        
    } catch (error) {
        console.error('Stream error:', error);
        res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
        res.end();
    }
});

// Анализ кода
app.post('/api/analyze-code', upload.single('file'), async (req, res) => {
    console.log('🔍 Code analysis request');
    
    let codeContent = req.body.code;
    let language = req.body.language || 'javascript';
    
    if (req.file) {
        try {
            codeContent = fs.readFileSync(req.file.path, 'utf-8');
            language = req.file.originalname.split('.').pop();
            fs.unlinkSync(req.file.path);
        } catch (error) {
            console.error('File read error:', error);
        }
    }
    
    if (!codeContent) {
        return res.status(400).json({ error: 'Код не предоставлен' });
    }
    
    if (codeContent.length > 50000) {
        codeContent = codeContent.substring(0, 50000) + '\n... (код обрезан)';
    }
    
    const prompt = `Проанализируй этот код на ${language}:

\`\`\`${language}
${codeContent}
\`\`\`

Предоставь анализ по пунктам:
1. Общая оценка
2. Проблемы и баги
3. Рекомендации
4. Пример исправления

Отвечай на русском языке.`;
    
    // Если нет API ключа
    if (!process.env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY === 'your_api_key_here') {
        return res.json({
            analysis: `⚠️ **API ключ не настроен**\n\nКод получен, но для анализа требуется настроить DeepSeek API ключ в переменных окружения Render.\n\n**Полученный код:**\n\`\`\`${language}\n${codeContent.substring(0, 500)}\n\`\`\``
        });
    }
    
    try {
        const response = await axios.post('https://api.deepseek.com/v1/chat/completions', {
            model: 'deepseek-chat',
            messages: [
                { role: 'system', content: 'Ты эксперт по анализу кода. Отвечай структурированно на русском языке.' },
                { role: 'user', content: prompt }
            ],
            max_tokens: 8192,
            temperature: 0.3
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 90000
        });
        
        res.json({ analysis: response.data.choices[0].message.content });
        
    } catch (error) {
        console.error('Code analysis error:', error.message);
        res.status(500).json({ error: 'Ошибка анализа кода' });
    }
});

// Голосовой процесс
app.post('/api/voice/process', upload.single('voice'), (req, res) => {
    console.log('🎤 Voice process request');
    
    const text = req.body.text || '';
    
    if (req.file) {
        try {
            fs.unlinkSync(req.file.path);
        } catch (e) {}
    }
    
    res.json({
        success: true,
        recognized_text: text || 'Голосовое сообщение получено',
        answer: text ? `Вы сказали: "${text}". Как я могу помочь?` : 'Голосовое сообщение получено. Функция полного распознавания в разработке.'
    });
});

// Удалить сессию
app.delete('/api/chat/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    if (sessions.has(sessionId)) {
        sessions.delete(sessionId);
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'Сессия не найдена' });
    }
});

// ============================================
// СТАТИКА (ДОЛЖНА БЫТЬ ПОСЛЕ API)
// ============================================

// Корневой маршрут
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Обработка 404 - возвращаем index.html для SPA
app.get('*', (req, res) => {
    // Если это API запрос - возвращаем 404
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'API endpoint not found' });
    }
    // Иначе возвращаем index.html
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============================================
// ЗАПУСК
// ============================================

app.listen(PORT, '0.0.0.0', () => {
    console.log(`
    ╔══════════════════════════════════════════════════════════╗
    ║                                                          ║
    ║     🦅 СОКОЛОВ AI - СЕРВЕР ЗАПУЩЕН                       ║
    ║                                                          ║
    ║     📡 Порт: ${PORT}                                          ║
    ║     🌐 Режим: ${process.env.NODE_ENV || 'development'}                      ║
    ║     🔑 API Key: ${process.env.DEEPSEEK_API_KEY ? '✅ установлен' : '❌ не установлен'}           ║
    ║                                                          ║
    ║     🚀 http://localhost:${PORT}                                 ║
    ║                                                          ║
    ╚══════════════════════════════════════════════════════════╝
    `);
});

module.exports = app;
