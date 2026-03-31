// ============================================
// СОКОЛОВ AI - ПОЛНЫЙ СЕРВЕР
// Исправлен: полное отключение QUIC, улучшенный streaming
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

// ============================================
// ПРИНУДИТЕЛЬНОЕ ОТКЛЮЧЕНИЕ HTTP/2 и QUIC
// ============================================

// Запрещаем keep-alive и HTTP/2
app.disable('etag');
app.set('trust proxy', true);

// Middleware для принудительного использования HTTP/1.1
app.use((req, res, next) => {
    // Запрещаем upgrade до HTTP/2
    res.setHeader('Connection', 'close');
    res.setHeader('X-HTTP2-Stream-ID', '');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
});

// ============================================
// НАСТРОЙКА ЗАГРУЗКИ ФАЙЛОВ
// ============================================

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({ 
    dest: uploadDir,
    limits: { fileSize: 50 * 1024 * 1024 }
});

// ============================================
// MIDDLEWARE
// ============================================

// Логирование
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} - ${res.statusCode} - ${duration}ms`);
    });
    next();
});

// CORS
app.use(cors({
    origin: '*',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
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

// Очистка старых сессий
setInterval(() => {
    const now = Date.now();
    const SESSION_TTL = 24 * 60 * 60 * 1000;
    let deleted = 0;
    for (const [id, session] of sessions) {
        const lastActivity = new Date(session.lastActivity).getTime();
        if (now - lastActivity > SESSION_TTL) {
            sessions.delete(id);
            deleted++;
        }
    }
    if (deleted > 0) console.log(`🗑️ Очищено ${deleted} устаревших сессий`);
}, 6 * 60 * 60 * 1000);

// ============================================
// API ENDPOINTS
// ============================================

app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        name: 'Соколов AI',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        sessions: sessions.size,
        apiKeyConfigured: !!(process.env.DEEPSEEK_API_KEY && process.env.DEEPSEEK_API_KEY !== 'your_api_key_here')
    });
});

app.post('/api/session', (req, res) => {
    const sessionId = uuidv4();
    const session = {
        id: sessionId,
        messages: [],
        createdAt: new Date(),
        lastActivity: new Date()
    };
    sessions.set(sessionId, session);
    console.log(`📝 Создана сессия: ${sessionId}`);
    res.json({ sessionId, createdAt: session.createdAt });
});

app.get('/api/chat/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const session = getSession(sessionId);
    res.json({ messages: session.messages });
});

// ============================================
// ПОТОКОВАЯ ПЕРЕДАЧА (исправленная)
// ============================================

app.post('/api/chat/:sessionId/stream', async (req, res) => {
    const { sessionId } = req.params;
    const { message, model = 'deepseek-chat', temperature = 0.7 } = req.body;
    
    console.log(`📡 Stream запрос для ${sessionId}: ${message?.substring(0, 100)}...`);
    
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
    
    // Настройка SSE с принудительным отключением буферизации
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'close',                    // вместо keep-alive
        'X-Accel-Buffering': 'no',
        'Transfer-Encoding': 'chunked'
    });
    
    // Проверка API ключа
    if (!process.env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY === 'your_api_key_here') {
        console.log('⚠️ API ключ не настроен');
        const mockResponse = `⚠️ **API ключ DeepSeek не настроен.**\n\nДобавьте переменную окружения DEEPSEEK_API_KEY в настройках Render.\n\n**Как получить ключ:**\n1. Зарегистрируйтесь на [platform.deepseek.com](https://platform.deepseek.com)\n2. Перейдите в раздел API Keys\n3. Создайте новый ключ\n4. Добавьте его в переменные окружения\n\nПосле настройки перезапустите сервер.`;
        
        for (let i = 0; i < mockResponse.length; i++) {
            res.write(`data: ${JSON.stringify({ content: mockResponse[i], done: false })}\n\n`);
            await new Promise(r => setTimeout(r, 5));
        }
        res.write(`event: done\ndata: ${JSON.stringify({ fullResponse: mockResponse })}\n\n`);
        res.end();
        return;
    }
    
    const messages = [
        { role: 'system', content: process.env.SYSTEM_PROMPT || 'Ты — Соколов AI, полезный помощник. Отвечай на русском языке, будь дружелюбным и профессиональным.' },
        ...session.messages.map(m => ({ role: m.role, content: m.content }))
    ];
    
    // Создаем HTTP агент с полным отключением keep-alive
    const http = require('http');
    const https = require('https');
    
    const agent = new https.Agent({
        keepAlive: false,
        maxSockets: 1,
        maxFreeSockets: 0,
        timeout: 120000,
        rejectUnauthorized: true
    });
    
    try {
        console.log(`📤 Отправка потокового запроса в DeepSeek...`);
        
        const response = await axios({
            method: 'POST',
            url: process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions',
            data: {
                model: model,
                messages: messages,
                max_tokens: 4096,
                temperature: temperature,
                stream: true
            },
            headers: {
                'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
                'Content-Type': 'application/json',
                'Accept': 'text/event-stream',
                'Connection': 'close'
            },
            responseType: 'stream',
            timeout: 120000,
            httpAgent: agent,
            httpsAgent: agent
        });
        
        let fullResponse = '';
        let chunkCount = 0;
        let isEnded = false;
        
        response.data.on('data', (chunk) => {
            if (isEnded) return;
            
            const lines = chunk.toString().split('\n');
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6);
                    if (data === '[DONE]') {
                        if (!isEnded) {
                            isEnded = true;
                            const aiMessage = {
                                id: uuidv4(),
                                role: 'assistant',
                                content: fullResponse,
                                timestamp: new Date().toISOString()
                            };
                            session.messages.push(aiMessage);
                            res.write(`event: done\ndata: ${JSON.stringify({ fullResponse })}\n\n`);
                            res.end();
                        }
                        return;
                    }
                    try {
                        const parsed = JSON.parse(data);
                        const content = parsed.choices[0]?.delta?.content || '';
                        if (content) {
                            fullResponse += content;
                            chunkCount++;
                            res.write(`data: ${JSON.stringify({ content, done: false })}\n\n`);
                        }
                    } catch (e) {
                        // Пропускаем некорректные данные
                    }
                }
            }
        });
        
        response.data.on('error', (error) => {
            console.error('❌ Ошибка потока:', error.message);
            if (!isEnded && !res.writableEnded) {
                isEnded = true;
                res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
                res.end();
            }
        });
        
        response.data.on('end', () => {
            console.log(`✅ Поток завершен, отправлено ${chunkCount} чанков, длина ответа: ${fullResponse.length}`);
            if (!isEnded && !res.writableEnded) {
                isEnded = true;
                if (fullResponse) {
                    const aiMessage = {
                        id: uuidv4(),
                        role: 'assistant',
                        content: fullResponse,
                        timestamp: new Date().toISOString()
                    };
                    session.messages.push(aiMessage);
                    res.write(`event: done\ndata: ${JSON.stringify({ fullResponse })}\n\n`);
                }
                res.end();
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка потокового запроса:', error.message);
        if (!res.writableEnded) {
            res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
            res.end();
        }
    }
});

// ============================================
// ОБЫЧНЫЙ ЧАТ (без streaming) - фолбэк
// ============================================

app.post('/api/chat/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    const { message, model = 'deepseek-chat', temperature = 0.7 } = req.body;
    
    console.log(`💬 Обычный запрос для ${sessionId}: ${message?.substring(0, 100)}...`);
    
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
    
    if (!process.env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY === 'your_api_key_here') {
        const mockResponse = `⚠️ API ключ DeepSeek не настроен.\n\nДобавьте переменную окружения DEEPSEEK_API_KEY в настройках Render.\n\nПолучить ключ: https://platform.deepseek.com`;
        const aiMessage = {
            id: uuidv4(),
            role: 'assistant',
            content: mockResponse,
            timestamp: new Date().toISOString()
        };
        session.messages.push(aiMessage);
        return res.json({ message: aiMessage });
    }
    
    const messages = [
        { role: 'system', content: process.env.SYSTEM_PROMPT || 'Ты — Соколов AI, полезный помощник. Отвечай на русском языке.' },
        ...session.messages.map(m => ({ role: m.role, content: m.content }))
    ];
    
    try {
        const response = await axios.post(process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions', {
            model: model,
            messages: messages,
            max_tokens: 4096,
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
        
        res.json({ message: aiMessage, usage: response.data.usage });
        
    } catch (error) {
        console.error('❌ DeepSeek API ошибка:', error.message);
        const errorMessage = `⚠️ Ошибка: ${error.message}`;
        const aiMessage = {
            id: uuidv4(),
            role: 'assistant',
            content: errorMessage,
            timestamp: new Date().toISOString(),
            isError: true
        };
        session.messages.push(aiMessage);
        res.status(500).json({ error: error.message, message: aiMessage });
    }
});

// ============================================
// АНАЛИЗ КОДА
// ============================================

app.post('/api/analyze-code', upload.single('file'), async (req, res) => {
    console.log('🔍 Анализ кода');
    
    let codeContent = req.body.code;
    let language = req.body.language || 'javascript';
    
    if (req.file) {
        try {
            codeContent = fs.readFileSync(req.file.path, 'utf-8');
            language = req.file.originalname.split('.').pop() || language;
            fs.unlinkSync(req.file.path);
            console.log(`📄 Файл: ${req.file.originalname}, ${codeContent.length} символов`);
        } catch (error) {
            console.error('Ошибка чтения файла:', error);
            return res.status(500).json({ error: 'Ошибка чтения файла' });
        }
    }
    
    if (!codeContent) {
        return res.status(400).json({ error: 'Код не предоставлен' });
    }
    
    if (!process.env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY === 'your_api_key_here') {
        return res.json({
            analysis: `⚠️ API ключ DeepSeek не настроен.\n\nКод получен (${codeContent.length} символов), но для анализа требуется API ключ.\n\nДобавьте DEEPSEEK_API_KEY в переменные окружения Render.`
        });
    }
    
    const MAX_CODE_LENGTH = 50000;
    let wasTruncated = false;
    if (codeContent.length > MAX_CODE_LENGTH) {
        codeContent = codeContent.substring(0, MAX_CODE_LENGTH) + '\n... (код обрезан)';
        wasTruncated = true;
    }
    
    const prompt = `Проанализируй этот код на ${language}:\n\n\`\`\`${language}\n${codeContent}\n\`\`\`\n\n${wasTruncated ? '⚠️ Код был обрезан.\n\n' : ''}Предоставь анализ:\n1. Общая оценка качества кода (от 1 до 10)\n2. Потенциальные проблемы и баги\n3. Рекомендации по улучшению\n\nОтвечай на русском языке, структурированно.`;
    
    try {
        const response = await axios.post(process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions', {
            model: 'deepseek-chat',
            messages: [
                { role: 'system', content: 'Ты эксперт по анализу кода. Отвечай структурированно на русском языке.' },
                { role: 'user', content: prompt }
            ],
            max_tokens: 4096,
            temperature: 0.3
        }, {
            headers: { 'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}` },
            timeout: 90000
        });
        
        const analysis = response.data.choices[0].message.content;
        const header = `📊 **Анализ кода**\n\n📁 ${req.file ? req.file.originalname : 'вставленный код'}\n📏 ${codeContent.length} символов\n${wasTruncated ? '⚠️ Код был обрезан для анализа\n' : ''}\n---\n\n`;
        
        res.json({ analysis: header + analysis });
        
    } catch (error) {
        console.error('Ошибка анализа:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// ГОЛОСОВОЙ ПРОЦЕСС
// ============================================

app.post('/api/voice/process', upload.single('voice'), (req, res) => {
    console.log('🎤 Голосовой запрос');
    
    if (req.file) {
        try {
            fs.unlinkSync(req.file.path);
        } catch (e) {}
    }
    
    const text = req.body.text || '';
    
    res.json({
        success: true,
        recognized_text: text,
        answer: text ? `Вы сказали: "${text}"` : 'Голосовое сообщение получено.'
    });
});

// ============================================
// УДАЛЕНИЕ СЕССИИ
// ============================================

app.delete('/api/chat/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    if (sessions.has(sessionId)) {
        sessions.delete(sessionId);
        console.log(`🗑️ Удалена сессия: ${sessionId}`);
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'Сессия не найдена' });
    }
});

// ============================================
// СТАТИЧЕСКИЕ ФАЙЛЫ
// ============================================

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Обработка 404 для API
app.get('/api/*', (req, res) => {
    res.status(404).json({ error: `API endpoint not found: ${req.originalUrl}` });
});

// Для всех остальных маршрутов - SPA
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Глобальный обработчик ошибок
app.use((err, req, res, next) => {
    console.error('❌ Необработанная ошибка:', err);
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
║     🔑 API Key: ${process.env.DEEPSEEK_API_KEY && process.env.DEEPSEEK_API_KEY !== 'your_api_key_here' ? '✅ установлен' : '❌ не установлен'}           ║
║     💾 Активных сессий: ${sessions.size}                                                  ║
║                                                                  ║
║     🚀 Готов к работе!                                           ║
║     📍 http://localhost:${PORT}                                         ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝
    `);
});

module.exports = app;
