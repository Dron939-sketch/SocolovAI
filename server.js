// ============================================
// СОКОЛОВ AI - СЕРВЕРНАЯ ЧАСТЬ
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
const upload = multer({ dest: 'uploads/' });

// ============================================
// MIDDLEWARE
// ============================================

// Безопасность
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "https:"],
        },
    },
}));

// CORS
app.use(cors({
    origin: process.env.CORS_ORIGIN?.split(',') || '*',
    credentials: true
}));

// Парсеры
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Статические файлы
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiting
const limiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000,
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
    message: { error: 'Слишком много запросов. Попробуйте позже.' }
});
app.use('/api/', limiter);

// ============================================
// ХРАНИЛИЩЕ ЧАТОВ (в памяти, для демо)
// ============================================

const sessions = new Map();

// ============================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================

function getSession(sessionId) {
    if (!sessions.has(sessionId)) {
        sessions.set(sessionId, {
            id: sessionId,
            messages: [],
            createdAt: new Date(),
            lastActivity: new Date()
        });
    }
    return sessions.get(sessionId);
}

function saveSession(sessionId, session) {
    session.lastActivity = new Date();
    sessions.set(sessionId, session);
}

// Очистка старых сессий (раз в час)
setInterval(() => {
    const now = new Date();
    for (const [id, session] of sessions) {
        if (now - session.lastActivity > 24 * 60 * 60 * 1000) {
            sessions.delete(id);
        }
    }
}, 60 * 60 * 1000);

// ============================================
// API ENDPOINTS
// ============================================

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        name: 'Соколов AI',
        version: '1.0.0',
        timestamp: new Date().toISOString()
    });
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
    res.json({ sessionId });
});

// Получить историю чата
app.get('/api/chat/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const session = getSession(sessionId);
    res.json({ messages: session.messages });
});

// Отправить сообщение
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
        { role: 'system', content: process.env.SYSTEM_PROMPT },
        ...session.messages.map(m => ({ role: m.role, content: m.content }))
    ];
    
    try {
        // Отправляем запрос к DeepSeek API
        const response = await axios.post(process.env.DEEPSEEK_API_URL, {
            model: model,
            messages: messages,
            max_tokens: parseInt(process.env.MAX_TOKENS),
            temperature: temperature,
            stream: false
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        
        const aiResponse = response.data.choices[0].message.content;
        
        // Добавляем ответ AI
        const aiMessage = {
            id: uuidv4(),
            role: 'assistant',
            content: aiResponse,
            timestamp: new Date().toISOString(),
            usage: response.data.usage
        };
        session.messages.push(aiMessage);
        
        saveSession(sessionId, session);
        
        res.json({
            message: aiMessage,
            usage: response.data.usage
        });
        
    } catch (error) {
        console.error('DeepSeek API error:', error.response?.data || error.message);
        
        // Возвращаем дружелюбную ошибку
        const errorMessage = {
            id: uuidv4(),
            role: 'assistant',
            content: 'Извините, произошла ошибка при обработке запроса. Пожалуйста, попробуйте позже.',
            timestamp: new Date().toISOString(),
            isError: true
        };
        session.messages.push(errorMessage);
        saveSession(sessionId, session);
        
        res.status(500).json({ 
            error: 'Ошибка при обращении к AI',
            message: errorMessage
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
    
    // Добавляем сообщение пользователя
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
        { role: 'system', content: process.env.SYSTEM_PROMPT },
        ...session.messages.map(m => ({ role: m.role, content: m.content }))
    ];
    
    try {
        const response = await axios.post(process.env.DEEPSEEK_API_URL, {
            model: model,
            messages: messages,
            max_tokens: parseInt(process.env.MAX_TOKENS),
            temperature: temperature,
            stream: true
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
                'Content-Type': 'application/json'
            },
            responseType: 'stream'
        });
        
        let fullResponse = '';
        
        response.data.on('data', (chunk) => {
            const lines = chunk.toString().split('\n');
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6);
                    if (data === '[DONE]') {
                        // Сохраняем полный ответ
                        const aiMessage = {
                            id: uuidv4(),
                            role: 'assistant',
                            content: fullResponse,
                            timestamp: new Date().toISOString()
                        };
                        session.messages.push(aiMessage);
                        saveSession(sessionId, session);
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
                        // Пропускаем некорректные данные
                    }
                }
            }
        });
        
        response.data.on('error', (error) => {
            console.error('Stream error:', error);
            res.write(`event: error\ndata: ${JSON.stringify({ error: 'Ошибка потока' })}\n\n`);
            res.end();
        });
        
    } catch (error) {
        console.error('DeepSeek API stream error:', error);
        res.write(`event: error\ndata: ${JSON.stringify({ error: 'Ошибка соединения с AI' })}\n\n`);
        res.end();
    }
});

// Анализ кода
app.post('/api/analyze-code', upload.single('file'), async (req, res) => {
    const { code, language, sessionId } = req.body;
    let codeContent = code;
    
    // Если загружен файл
    if (req.file) {
        codeContent = fs.readFileSync(req.file.path, 'utf-8');
        fs.unlinkSync(req.file.path);
    }
    
    if (!codeContent) {
        return res.status(400).json({ error: 'Код не предоставлен' });
    }
    
    const prompt = `Проанализируй этот код на ${language || 'JavaScript'}:

\`\`\`${language || 'javascript'}
${codeContent}
\`\`\`

Предоставь анализ по следующим пунктам:
1. Общая оценка качества кода
2. Потенциальные проблемы и баги
3. Рекомендации по улучшению
4. Пример исправленного фрагмента (если нужно)

Отвечай на русском языке.`;

    try {
        const response = await axios.post(process.env.DEEPSEEK_API_URL, {
            model: process.env.DEFAULT_MODEL,
            messages: [
                { role: 'system', content: 'Ты эксперт по анализу кода. Отвечай структурированно и подробно.' },
                { role: 'user', content: prompt }
            ],
            max_tokens: 8192,
            temperature: 0.3
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        
        res.json({
            analysis: response.data.choices[0].message.content,
            usage: response.data.usage
        });
        
    } catch (error) {
        console.error('Code analysis error:', error);
        res.status(500).json({ error: 'Ошибка анализа кода' });
    }
});

// Голосовое распознавание (прокси)
app.post('/api/voice/process', upload.single('voice'), async (req, res) => {
    // Здесь можно интегрировать с сервисом распознавания речи
    // Пока возвращаем заглушку
    res.json({
        success: true,
        recognized_text: req.body.text || 'Голосовое сообщение получено',
        answer: 'Ваше голосовое сообщение получено. Функция полного распознавания в разработке.'
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
// ЗАПУСК СЕРВЕРА
// ============================================

app.listen(PORT, () => {
    console.log(`
    ╔══════════════════════════════════════════════════════════╗
    ║                                                          ║
    ║     🦅 СОКОЛОВ AI - СЕРВЕР ЗАПУЩЕН                       ║
    ║                                                          ║
    ║     📡 Порт: ${PORT}                                          ║
    ║     🌐 Режим: ${process.env.NODE_ENV || 'development'}                          ║
    ║     🤖 Модель: ${process.env.DEFAULT_MODEL}                              ║
    ║                                                          ║
    ║     🚀 Готов к работе!                                   ║
    ║     📍 http://localhost:${PORT}                                 ║
    ║                                                          ║
    ╚════════════════════════════════════════════════════════════╝
    `);
});

module.exports = app;
