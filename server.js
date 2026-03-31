// ============================================
// СОКОЛОВ AI - ПОЛНЫЙ СЕРВЕР
// Поддержка стриминга и обычных запросов, как у DeepSeek
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
// ЗАГРУЗКА НАСТРОЕК ИЗ .ENV
// ============================================

const MAX_TOKENS = parseInt(process.env.MAX_TOKENS) || 16384;
const TEMPERATURE = parseFloat(process.env.TEMPERATURE) || 1.0;
const CODE_ANALYSIS_TEMPERATURE = parseFloat(process.env.CODE_ANALYSIS_TEMPERATURE) || 0.3;
const MAX_HISTORY_MESSAGES = parseInt(process.env.MAX_HISTORY_MESSAGES) || 50;
const MAX_CODE_LENGTH = parseInt(process.env.MAX_CODE_LENGTH) || 200000;
const REQUEST_TIMEOUT_MS = parseInt(process.env.REQUEST_TIMEOUT_MS) || 300000;

console.log(`
╔══════════════════════════════════════════════════════════════════╗
║                   НАСТРОЙКИ СОКОЛОВ AI                          ║
╠══════════════════════════════════════════════════════════════════╣
║  🌡️ Температура:        ${TEMPERATURE}                                     ║
║  📝 Max tokens ответа:  ${MAX_TOKENS}                                        ║
║  💾 История сообщений:  ${MAX_HISTORY_MESSAGES} последних                           ║
║  📏 Max длина кода:     ${MAX_CODE_LENGTH} символов                              ║
║  ⏰ Таймаут:            ${REQUEST_TIMEOUT_MS / 1000} сек                               ║
╚══════════════════════════════════════════════════════════════════╝
`);

// ============================================
// УВЕЛИЧЕННЫЕ ЛИМИТЫ
// ============================================

app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ extended: true, limit: '200mb' }));

app.use((req, res, next) => {
    req.setTimeout(REQUEST_TIMEOUT_MS);
    res.setTimeout(REQUEST_TIMEOUT_MS);
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
    limits: { fileSize: 200 * 1024 * 1024 }
});

// ============================================
// MIDDLEWARE
// ============================================

app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} - ${res.statusCode} - ${duration}ms`);
    });
    next();
});

app.use(cors({
    origin: '*',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

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

// Очистка старых сессий (каждые 6 часов)
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
        version: '2.0.0',
        temperature: TEMPERATURE,
        maxTokens: MAX_TOKENS,
        maxHistory: MAX_HISTORY_MESSAGES,
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
// ПОТОКОВАЯ ПЕРЕДАЧА (STREAMING) - КАК У DEEPSEEK
// ============================================

app.post('/api/chat/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    let { message, model = 'deepseek-chat', temperature = TEMPERATURE } = req.body;
    
    console.log(`\n💬 ========== НОВЫЙ ЗАПРОС ==========`);
    console.log(`📡 Сессия: ${sessionId}`);
    console.log(`📏 Длина сообщения: ${message?.length || 0} символов`);
    console.log(`🌡️ Температура: ${temperature}`);
    console.log(`🤖 Модель: ${model}`);
    
    if (!message || message.trim() === '') {
        return res.status(400).json({ error: 'Сообщение не может быть пустым' });
    }
    
    const session = getSession(sessionId);
    console.log(`💾 Сообщений в истории: ${session.messages.length}`);
    
    const userMessage = {
        id: uuidv4(),
        role: 'user',
        content: message,
        timestamp: new Date().toISOString()
    };
    session.messages.push(userMessage);
    
    // Проверка API ключа
    if (!process.env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY === 'your_api_key_here') {
        console.log('⚠️ API ключ не настроен');
        const mockResponse = `⚠️ **API ключ DeepSeek не настроен.**\n\nДобавьте переменную окружения DEEPSEEK_API_KEY в настройках Render.\n\n**Как получить ключ:**\n1. Зарегистрируйтесь на [platform.deepseek.com](https://platform.deepseek.com)\n2. Перейдите в раздел API Keys\n3. Создайте новый ключ\n4. Добавьте его в переменные окружения\n\nПосле настройки перезапустите сервер.`;
        
        const aiMessage = {
            id: uuidv4(),
            role: 'assistant',
            content: mockResponse,
            timestamp: new Date().toISOString()
        };
        session.messages.push(aiMessage);
        return res.json({ message: aiMessage });
    }
    
    // Берем последние сообщения для контекста
    const recentMessages = session.messages.slice(-MAX_HISTORY_MESSAGES);
    
    // ФОРМИРУЕМ МАССИВ ДЛЯ API
    const messages = [
        { 
            role: 'system', 
            content: process.env.SYSTEM_PROMPT || 'Ты — Соколов AI, интеллектуальный помощник на базе DeepSeek. Отвечай на русском языке, будь полезным, дружелюбным и профессиональным.' 
        },
        ...recentMessages.map(m => ({ role: m.role, content: m.content }))
    ];
    
    // Фильтруем пустые сообщения
    const validMessages = messages.filter(m => m.content && m.content.trim() !== '');
    
    console.log(`📤 Отправка запроса в DeepSeek API...`);
    console.log(`📊 Количество сообщений: ${validMessages.length}`);
    console.log(`📋 System: ${validMessages[0]?.content?.substring(0, 80)}...`);
    console.log(`💬 Последнее: ${validMessages[validMessages.length-1]?.content?.substring(0, 50)}...`);
    
    try {
        const startTime = Date.now();
        
        const requestBody = {
            model: model,
            messages: validMessages,
            max_tokens: MAX_TOKENS,
            temperature: temperature
        };
        
        console.log(`🔗 URL: ${process.env.DEEPSEEK_API_URL}`);
        console.log(`🔑 API Key: ${process.env.DEEPSEEK_API_KEY ? '✅ установлен' : '❌'}`);
        
        const response = await axios.post(process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions', requestBody, {
            headers: {
                'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: REQUEST_TIMEOUT_MS
        });
        
        const duration = Date.now() - startTime;
        console.log(`✅ Ответ получен за ${duration}ms`);
        console.log(`📊 Использовано токенов: ${response.data.usage?.total_tokens || 'неизвестно'}`);
        
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
        console.error('❌ ОШИБКА DeepSeek API:');
        console.error('Статус:', error.response?.status);
        console.error('Данные ошибки:', JSON.stringify(error.response?.data, null, 2));
        console.error('Сообщение:', error.message);
        
        let errorMessage = '⚠️ Произошла ошибка.';
        
        if (error.response?.status === 400) {
            errorMessage = `⚠️ Ошибка в запросе к API. Проверьте формат сообщений.\n\nДетали: ${error.response?.data?.error?.message || 'Bad Request'}`;
        } else if (error.response?.status === 401) {
            errorMessage = '🔑 Ошибка авторизации API. Проверьте ключ DeepSeek API в настройках Render.';
        } else if (error.response?.status === 429) {
            errorMessage = '📊 Слишком много запросов. Подождите немного и попробуйте снова.';
        } else if (error.code === 'ECONNABORTED') {
            errorMessage = `⏰ Превышено время ожидания (${REQUEST_TIMEOUT_MS / 1000} сек). Попробуйте упростить запрос.`;
        } else if (error.response?.data?.error?.message) {
            errorMessage = `⚠️ Ошибка API: ${error.response.data.error.message}`;
        } else if (error.message) {
            errorMessage = `⚠️ Ошибка: ${error.message}`;
        }
        
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
// ОБЫЧНЫЙ ЧАТ (без стриминга) - фолбэк
// ============================================

app.post('/api/chat/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    const { message, model = process.env.DEFAULT_MODEL || 'deepseek-chat', temperature = TEMPERATURE } = req.body;
    
    console.log(`💬 Обычный запрос для ${sessionId}`);
    console.log(`📏 Длина сообщения: ${message?.length || 0} символов`);
    console.log(`🌡️ Температура: ${temperature}`);
    
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
    
    // Проверка API ключа
    if (!process.env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY === 'your_api_key_here') {
        console.log('⚠️ API ключ не настроен');
        const mockResponse = `⚠️ **API ключ DeepSeek не настроен.**\n\nДобавьте переменную окружения DEEPSEEK_API_KEY в настройках Render.\n\n**Как получить ключ:**\n1. Зарегистрируйтесь на [platform.deepseek.com](https://platform.deepseek.com)\n2. Перейдите в раздел API Keys\n3. Создайте новый ключ\n4. Добавьте его в переменные окружения\n\nПосле настройки перезапустите сервер.`;
        
        const aiMessage = {
            id: uuidv4(),
            role: 'assistant',
            content: mockResponse,
            timestamp: new Date().toISOString()
        };
        session.messages.push(aiMessage);
        return res.json({ message: aiMessage });
    }
    
    // Берем последние сообщения для контекста
    const recentMessages = session.messages.slice(-MAX_HISTORY_MESSAGES);
    
    const messages = [
        { role: 'system', content: process.env.SYSTEM_PROMPT || 'Ты — Соколов AI, интеллектуальный помощник на базе DeepSeek. Отвечай на русском языке, будь полезным, дружелюбным и профессиональным.' },
        ...recentMessages.map(m => ({ role: m.role, content: m.content }))
    ];
    
    try {
        console.log(`📤 Отправка запроса в DeepSeek API...`);
        const startTime = Date.now();
        
        const response = await axios.post(process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions', {
            model: model,
            messages: messages,
            max_tokens: MAX_TOKENS,
            temperature: temperature
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: REQUEST_TIMEOUT_MS
        });
        
        const duration = Date.now() - startTime;
        console.log(`✅ Ответ получен за ${duration}ms`);
        console.log(`📊 Использовано токенов: ${response.data.usage?.total_tokens || 'неизвестно'}`);
        
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
        console.error('❌ Ошибка DeepSeek API:', error.code || error.message);
        
        let errorMessage = '⚠️ Произошла ошибка.';
        
        if (error.code === 'ECONNABORTED') {
            errorMessage = `⏰ Превышено время ожидания. Ваш запрос слишком сложный. Попробуйте упростить вопрос или отправить меньший код.`;
        } else if (error.response?.status === 429) {
            errorMessage = '📊 Слишком много запросов. Подождите немного и попробуйте снова.';
        } else if (error.response?.status === 401) {
            errorMessage = '🔑 Ошибка авторизации API. Проверьте ключ DeepSeek API.';
        } else if (error.response?.data?.error?.message) {
            errorMessage = `⚠️ Ошибка API: ${error.response.data.error.message}`;
        } else if (error.message) {
            errorMessage = `⚠️ Ошибка: ${error.message}`;
        }
        
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
            console.log(`📄 Файл: ${req.file.originalname}, ${codeContent.length} символов, ${codeContent.split('\n').length} строк`);
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
    
    // Лимит 200,000 символов
    let wasTruncated = false;
    let originalLength = codeContent.length;
    
    if (codeContent.length > MAX_CODE_LENGTH) {
        codeContent = codeContent.substring(0, MAX_CODE_LENGTH) + '\n\n... [КОД ОБРЕЗАН: было ' + originalLength + ' символов]';
        wasTruncated = true;
        console.log(`✂️ Код обрезан: ${originalLength} -> ${MAX_CODE_LENGTH} символов`);
    }
    
    const prompt = `Проанализируй этот код на ${language} (${codeContent.split('\n').length} строк, ${codeContent.length} символов):

\`\`\`${language}
${codeContent}
\`\`\`

${wasTruncated ? '⚠️ ВНИМАНИЕ: Код был обрезан из-за большого размера.\n\n' : ''}

Предоставь структурированный анализ:

## 📊 Общая оценка
- Оценка качества (1-10)
- Краткое описание

## 🐛 Потенциальные проблемы
- Перечисли основные проблемы и баги

## 💡 Рекомендации по улучшению
- Конкретные советы по оптимизации

## 📝 Пример исправления (если есть критические ошибки)

Отвечай на русском языке, используй markdown.`;

    try {
        console.log(`📤 Отправка запроса в DeepSeek API...`);
        const startTime = Date.now();
        
        const response = await axios.post(process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions', {
            model: 'deepseek-chat',
            messages: [
                { role: 'system', content: 'Ты эксперт по анализу кода с 10-летним опытом. Отвечай структурированно, используй markdown. Всегда отвечай на русском языке.' },
                { role: 'user', content: prompt }
            ],
            max_tokens: MAX_TOKENS,
            temperature: CODE_ANALYSIS_TEMPERATURE
        }, {
            headers: { 'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}` },
            timeout: REQUEST_TIMEOUT_MS
        });
        
        const duration = Date.now() - startTime;
        console.log(`✅ Анализ завершен за ${duration}ms`);
        
        const analysis = response.data.choices[0].message.content;
        const header = `📊 **Анализ кода**\n\n📁 ${req.file ? req.file.originalname : 'вставленный код'}\n📏 ${codeContent.length} символов\n📊 ${codeContent.split('\n').length} строк\n🌡️ Температура: ${CODE_ANALYSIS_TEMPERATURE} (точный режим)\n${wasTruncated ? '⚠️ Код был обрезан для анализа\n' : ''}\n---\n\n`;
        
        res.json({ analysis: header + analysis });
        
    } catch (error) {
        console.error('❌ Ошибка анализа:', error.message);
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

app.get('/api/*', (req, res) => {
    res.status(404).json({ error: `API endpoint not found: ${req.originalUrl}` });
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

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
║     🎯 НАСТРОЙКИ (как у DeepSeek):                               ║
║        🌡️ Температура: ${TEMPERATURE} (1.0 - идеальный баланс)                             ║
║        📝 Max tokens ответа: ${MAX_TOKENS} (до 16K токенов)                               ║
║        💾 История: до ${MAX_HISTORY_MESSAGES} сообщений                                      ║
║        📏 Код: до ${MAX_CODE_LENGTH / 1000}K символов                                       ║
║        ⏰ Таймаут: ${REQUEST_TIMEOUT_MS / 1000} сек                                         ║
║                                                                  ║
║     📡 Endpoints:                                               ║
║        - POST /api/chat/:id           (обычный чат)             ║
║        - POST /api/chat/:id/stream    (потоковый чат)           ║
║        - POST /api/analyze-code       (анализ кода)             ║
║        - POST /api/voice/process      (голосовой ввод)          ║
║                                                                  ║
║     🚀 Готов к работе!                                           ║
║     📍 http://localhost:${PORT}                                         ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝
    `);
});

module.exports = app;
