// ============================================
// СОКОЛОВ AI - СЕРВЕРНАЯ ЧАСТЬ
// Оптимизировано для деплоя на Render
// ============================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

// Инициализация
const app = express();
const PORT = process.env.PORT || 3000;

// Создаем папку для загрузок (для Render)
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({ dest: uploadDir });

// ============================================
// MIDDLEWARE
// ============================================

// Безопасность (настроено для Render)
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'", "https://api.deepseek.com"],
        },
    },
    crossOriginEmbedderPolicy: false,
}));

// CORS для Render
app.use(cors({
    origin: process.env.CORS_ORIGIN?.split(',') || ['https://sokolov-ai.onrender.com', 'http://localhost:3000'],
    credentials: true
}));

// Парсеры
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Статические файлы
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiting для защиты от злоупотреблений
const limiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000,
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
    message: { error: 'Слишком много запросов. Попробуйте позже.' },
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api/', limiter);

// ============================================
// ХРАНИЛИЩЕ СЕССИЙ (в памяти)
// Для production лучше использовать Redis, но для Render free хватит
// ============================================

const sessions = new Map();

// Очистка старых сессий каждые 6 часов
setInterval(() => {
    const now = Date.now();
    const SESSION_TTL = 24 * 60 * 60 * 1000; // 24 часа
    
    for (const [id, session] of sessions) {
        const lastActivity = new Date(session.lastActivity).getTime();
        if (now - lastActivity > SESSION_TTL) {
            sessions.delete(id);
            console.log(`🗑️ Session ${id} expired`);
        }
    }
}, 6 * 60 * 60 * 1000);

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
// API ENDPOINTS
// ============================================

// Health check для Render
app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        name: 'Соколов AI',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        sessions: sessions.size
    });
});

// Корневой маршрут
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Создать новую сессию
app.post('/api/session', (req, res) => {
    const sessionId = uuidv4();
    const session = {
        id: sessionId,
        messages: [],
        createdAt: new Date(),
        lastActivity: new Date()
    };
    sessions.set(sessionId, session);
    res.json({ sessionId, createdAt: session.createdAt });
});

// Получить историю чата
app.get('/api/chat/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const session = getSession(sessionId);
    res.json({ messages: session.messages });
});

// Отправить сообщение (без streaming)
app.post('/api/chat/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    const { message, model = process.env.DEFAULT_MODEL, temperature = parseFloat(process.env.TEMPERATURE) } = req.body;
    
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
    
    // Формируем запрос к DeepSeek
    const messages = [
        { role: 'system', content: process.env.SYSTEM_PROMPT || 'Ты — Соколов AI, полезный помощник.' },
        ...session.messages.map(m => ({ role: m.role, content: m.content }))
    ];
    
    try {
        const response = await axios.post(process.env.DEEPSEEK_API_URL, {
            model: model,
            messages: messages,
            max_tokens: parseInt(process.env.MAX_TOKENS) || 4096,
            temperature: temperature,
            stream: false
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
        
        res.json({
            message: aiMessage,
            usage: response.data.usage
        });
        
    } catch (error) {
        console.error('DeepSeek API error:', error.response?.data || error.message);
        
        const errorMessage = {
            id: uuidv4(),
            role: 'assistant',
            content: 'Извините, произошла ошибка при обработке запроса. Пожалуйста, попробуйте позже.',
            timestamp: new Date().toISOString(),
            isError: true
        };
        session.messages.push(errorMessage);
        
        res.status(500).json({ 
            error: 'Ошибка при обращении к AI',
            message: errorMessage,
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Потоковая передача (Streaming)
app.post('/api/chat/:sessionId/stream', async (req, res) => {
    const { sessionId } = req.params;
    const { message, model = process.env.DEFAULT_MODEL, temperature = parseFloat(process.env.TEMPERATURE) } = req.body;
    
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
    
    // Настройки SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    
    const messages = [
        { role: 'system', content: process.env.SYSTEM_PROMPT || 'Ты — Соколов AI, полезный помощник.' },
        ...session.messages.map(m => ({ role: m.role, content: m.content }))
    ];
    
    try {
        const response = await axios.post(process.env.DEEPSEEK_API_URL, {
            model: model,
            messages: messages,
            max_tokens: parseInt(process.env.MAX_TOKENS) || 4096,
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
                    } catch (e) {
                        // Пропускаем
                    }
                }
            }
        });
        
        response.data.on('error', (error) => {
            console.error('Stream error:', error);
            res.write(`event: error\ndata: ${JSON.stringify({ error: 'Ошибка потока' })}\n\n`);
            res.end();
        });
        
        response.data.on('end', () => {
            if (fullResponse) {
                const aiMessage = {
                    id: uuidv4(),
                    role: 'assistant',
                    content: fullResponse,
                    timestamp: new Date().toISOString()
                };
                session.messages.push(aiMessage);
            }
        });
        
    } catch (error) {
        console.error('DeepSeek API stream error:', error);
        res.write(`event: error\ndata: ${JSON.stringify({ error: 'Ошибка соединения с AI' })}\n\n`);
        res.end();
    }
});

// Анализ кода
app.post('/api/analyze-code', upload.single('file'), async (req, res) => {
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
    
    // Ограничиваем длину для API
    if (codeContent.length > 50000) {
        codeContent = codeContent.substring(0, 50000) + '\n... (код обрезан)';
    }
    
    const prompt = `Проанализируй этот код на ${language}:

\`\`\`${language}
${codeContent}
\`\`\`

Предоставь анализ по следующим пунктам:
1. Общая оценка качества кода
2. Потенциальные проблемы и баги
3. Рекомендации по улучшению
4. Пример исправленного фрагмента (если нужно)

Отвечай на русском языке, структурированно.`;

    try {
        const response = await axios.post(process.env.DEEPSEEK_API_URL, {
            model: process.env.DEFAULT_MODEL,
            messages: [
                { role: 'system', content: 'Ты эксперт по анализу кода. Отвечай структурированно и подробно на русском языке.' },
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
        
        res.json({
            analysis: response.data.choices[0].message.content,
            usage: response.data.usage
        });
        
    } catch (error) {
        console.error('Code analysis error:', error.response?.data || error.message);
        res.status(500).json({ error: 'Ошибка анализа кода' });
    }
});

// Голосовое распознавание (прокси)
app.post('/api/voice/process', upload.single('voice'), async (req, res) => {
    const text = req.body.text || '';
    
    if (text) {
        res.json({
            success: true,
            recognized_text: text,
            answer: `Вы сказали: "${text}". Как я могу помочь?`
        });
        return;
    }
    
    if (req.file) {
        try {
            fs.unlinkSync(req.file.path);
        } catch (e) {}
    }
    
    res.json({
        success: true,
        recognized_text: 'Голосовое сообщение получено',
        answer: 'Голосовое сообщение получено. Функция полного распознавания в разработке.'
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

// Обработка 404
app.use((req, res) => {
    res.status(404).sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Обработка ошибок
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

// ============================================
// ЗАПУСК СЕРВЕРА
// ============================================

app.listen(PORT, '0.0.0.0', () => {
    console.log(`
    ╔══════════════════════════════════════════════════════════════════╗
    ║                                                                  ║
    ║     🦅 СОКОЛОВ AI - СЕРВЕР ЗАПУЩЕН                               ║
    ║                                                                  ║
    ║     📡 Порт: ${PORT}                                                 ║
    ║     🌐 Режим: ${process.env.NODE_ENV || 'development'}                                    ║
    ║     🤖 Модель: ${process.env.DEFAULT_MODEL || 'deepseek-chat'}                               ║
    ║     💾 Сессий: ${sessions.size}                                                  ║
    ║                                                                  ║
    ║     🚀 Готов к работе!                                           ║
    ║     📍 http://localhost:${PORT}                                           ║
    ║                                                                  ║
    ╚══════════════════════════════════════════════════════════════════╝
    `);
});

module.exports = app;
