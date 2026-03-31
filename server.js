// ============================================
// СОКОЛОВ AI - ПОЛНЫЙ СЕРВЕР
// Поддержка больших файлов, логирование, DeepSeek API
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
// НАСТРОЙКА ЗАГРУЗКИ ФАЙЛОВ
// ============================================

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({ 
    dest: uploadDir,
    limits: {
        fileSize: 50 * 1024 * 1024 // 50MB лимит
    }
});

// ============================================
// MIDDLEWARE
// ============================================

// Логирование всех запросов
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
    if (deleted > 0) {
        console.log(`🗑️ Очищено ${deleted} устаревших сессий`);
    }
}, 6 * 60 * 60 * 1000);

// ============================================
// API ENDPOINTS
// ============================================

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        name: 'Соколов AI',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        sessions: sessions.size,
        memory: process.memoryUsage(),
        apiKeyConfigured: !!(process.env.DEEPSEEK_API_KEY && process.env.DEEPSEEK_API_KEY !== 'your_api_key_here')
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
    console.log(`📝 Создана новая сессия: ${sessionId}`);
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
    const { message, model = process.env.DEFAULT_MODEL || 'deepseek-chat', temperature = 0.7 } = req.body;
    
    console.log(`💬 Получено сообщение для ${sessionId}: ${message?.substring(0, 100)}...`);
    
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
        const mockResponse = `🦅 **Соколов AI** отвечает:\n\nВы написали: "${message.substring(0, 200)}"\n\n⚠️ **API ключ DeepSeek не настроен.**\n\nДобавьте переменную окружения DEEPSEEK_API_KEY в настройках Render или в файл .env.\n\n**Инструкция:**\n1. Получите ключ на [platform.deepseek.com](https://platform.deepseek.com)\n2. Добавьте в переменные окружения: DEEPSEEK_API_KEY=sk-...\n3. Перезапустите сервер`;
        
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
        { role: 'system', content: process.env.SYSTEM_PROMPT || 'Ты — Соколов AI, полезный помощник. Отвечай на русском языке, будь дружелюбным и профессиональным.' },
        ...session.messages.map(m => ({ role: m.role, content: m.content }))
    ];
    
    try {
        console.log(`📤 Отправка запроса в DeepSeek API...`);
        
        const response = await axios.post(process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions', {
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
        
        console.log(`✅ Ответ получен от DeepSeek`);
        
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
        console.error('❌ DeepSeek API ошибка:', error.response?.data || error.message);
        
        let errorText = 'Извините, произошла ошибка при обработке запроса.';
        if (error.response?.data?.error?.message) {
            errorText = `Ошибка API: ${error.response.data.error.message}`;
        } else if (error.code === 'ECONNABORTED') {
            errorText = 'Превышено время ожидания ответа от AI. Попробуйте позже.';
        } else if (error.message) {
            errorText = error.message;
        }
        
        const aiMessage = {
            id: uuidv4(),
            role: 'assistant',
            content: `⚠️ **Ошибка:** ${errorText}\n\nПожалуйста, попробуйте еще раз или отправьте более короткое сообщение.`,
            timestamp: new Date().toISOString(),
            isError: true
        };
        session.messages.push(aiMessage);
        
        res.status(500).json({ error: errorText, message: aiMessage });
    }
});

// Потоковая передача
app.post('/api/chat/:sessionId/stream', async (req, res) => {
    const { sessionId } = req.params;
    const { message, model = process.env.DEFAULT_MODEL || 'deepseek-chat', temperature = 0.7 } = req.body;
    
    console.log(`📡 Потоковый запрос для ${sessionId}: ${message?.substring(0, 100)}...`);
    
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
    res.setHeader('X-Accel-Buffering', 'no');
    
    // Проверка API ключа
    if (!process.env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY === 'your_api_key_here') {
        console.log('⚠️ API ключ не настроен');
        const mockResponse = `⚠️ **API ключ DeepSeek не настроен.**\n\nДобавьте переменную окружения DEEPSEEK_API_KEY.\n\nПолучить ключ: https://platform.deepseek.com`;
        
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
        console.log(`📤 Отправка потокового запроса в DeepSeek...`);
        
        const response = await axios.post(process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions', {
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
                    } catch (e) {
                        // Пропускаем некорректные данные
                    }
                }
            }
        });
        
        response.data.on('error', (error) => {
            console.error('❌ Ошибка потока:', error);
            res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
            res.end();
        });
        
    } catch (error) {
        console.error('❌ Ошибка потокового запроса:', error.message);
        res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
        res.end();
    }
});

// ============================================
// АНАЛИЗ КОДА - УЛУЧШЕННАЯ ВЕРСИЯ
// ============================================

app.post('/api/analyze-code', upload.single('file'), async (req, res) => {
    console.log('\n🔍 ========== АНАЛИЗ КОДА ==========');
    console.log(`📁 Файл: ${req.file ? req.file.originalname : 'нет'}`);
    console.log(`📝 Код из body: ${req.body.code ? `${req.body.code.length} символов` : 'нет'}`);
    console.log(`🌐 Язык: ${req.body.language || 'auto'}`);
    
    let codeContent = req.body.code;
    let language = req.body.language || 'javascript';
    
    // Чтение файла если загружен
    if (req.file) {
        try {
            codeContent = fs.readFileSync(req.file.path, 'utf-8');
            language = req.file.originalname.split('.').pop() || language;
            console.log(`📄 Файл прочитан: ${req.file.originalname}`);
            console.log(`📏 Размер файла: ${codeContent.length} символов`);
            console.log(`📊 Количество строк: ${codeContent.split('\n').length}`);
            fs.unlinkSync(req.file.path);
        } catch (error) {
            console.error('❌ Ошибка чтения файла:', error);
            return res.status(500).json({ error: 'Ошибка чтения файла' });
        }
    }
    
    if (!codeContent) {
        console.log('❌ Код не предоставлен');
        return res.status(400).json({ error: 'Код не предоставлен' });
    }
    
    // Ограничиваем длину для API (100K символов)
    const MAX_CODE_LENGTH = 100000;
    let wasTruncated = false;
    if (codeContent.length > MAX_CODE_LENGTH) {
        console.log(`✂️ Код обрезан: ${codeContent.length} -> ${MAX_CODE_LENGTH} символов`);
        codeContent = codeContent.substring(0, MAX_CODE_LENGTH) + '\n... (код обрезан из-за длины)';
        wasTruncated = true;
    }
    
    // Проверка API ключа
    if (!process.env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY === 'your_api_key_here') {
        console.log('⚠️ API ключ не настроен');
        const preview = codeContent.length > 1000 ? codeContent.substring(0, 1000) + '\n... (обрезано)' : codeContent;
        return res.json({
            analysis: `⚠️ **API ключ DeepSeek не настроен**\n\nКод получен (${codeContent.length} символов, ${codeContent.split('\n').length} строк), но для анализа требуется настроить API ключ.\n\n**Как настроить:**\n1. Получите ключ на [platform.deepseek.com](https://platform.deepseek.com)\n2. Добавьте переменную окружения: \`DEEPSEEK_API_KEY=sk-...\`\n3. Перезапустите сервер\n\n**Первые 500 символов кода:**\n\`\`\`${language}\n${preview}\n\`\`\``
        });
    }
    
    // Формируем промпт для анализа
    const prompt = `Проанализируй этот код на ${language}:

\`\`\`${language}
${codeContent}
\`\`\`

${wasTruncated ? '⚠️ ВНИМАНИЕ: Код был обрезан из-за большого размера. Анализируй то, что есть.\n\n' : ''}

Предоставь анализ по следующим пунктам:

1. **Общая оценка качества кода** (от 1 до 10) и краткое описание
2. **Потенциальные проблемы и баги** (перечисли с пояснениями)
3. **Рекомендации по улучшению** (конкретные советы)
4. **Пример исправленного фрагмента** (если есть критические ошибки)

Отвечай на русском языке, структурированно, используй markdown.`;

    console.log(`📤 Отправка запроса в DeepSeek API...`);
    console.log(`📏 Длина промпта: ${prompt.length} символов`);
    
    try {
        const startTime = Date.now();
        
        const response = await axios.post(process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions', {
            model: process.env.DEFAULT_MODEL || 'deepseek-chat',
            messages: [
                { 
                    role: 'system', 
                    content: 'Ты эксперт по анализу кода с 10-летним опытом. Отвечай структурированно, используй markdown, будь полезным и конкретным. Всегда отвечай на русском языке.' 
                },
                { role: 'user', content: prompt }
            ],
            max_tokens: 8192,
            temperature: 0.3
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 120000
        });
        
        const duration = Date.now() - startTime;
        console.log(`✅ Ответ получен за ${duration}ms`);
        console.log(`📊 Использовано токенов: ${response.data.usage?.total_tokens || 'неизвестно'}`);
        
        let analysis = response.data.choices[0].message.content;
        
        // Добавляем информацию о размере кода
        const header = `📊 **Анализ кода**\n\n📁 Файл: ${req.file ? req.file.originalname : 'вставленный код'}\n📏 Размер: ${codeContent.length} символов\n📊 Строк: ${codeContent.split('\n').length}\n${wasTruncated ? '⚠️ Код был обрезан для анализа\n' : ''}\n---\n\n`;
        
        analysis = header + analysis;
        
        res.json({ 
            analysis: analysis,
            usage: response.data.usage,
            truncated: wasTruncated,
            size: codeContent.length,
            lines: codeContent.split('\n').length
        });
        
    } catch (error) {
        console.error('❌ Ошибка DeepSeek API:', error.response?.data || error.message);
        
        let errorMessage = 'Ошибка при анализе кода';
        let userMessage = 'Произошла ошибка при анализе кода. Попробуйте еще раз или отправьте код меньшего размера.';
        
        if (error.response?.data?.error?.message) {
            errorMessage = error.response.data.error.message;
            if (errorMessage.includes('rate limit')) {
                userMessage = 'Превышен лимит запросов к API. Подождите немного и попробуйте снова.';
            } else if (errorMessage.includes('context length')) {
                userMessage = 'Код слишком большой для обработки. Попробуйте отправить меньшую часть кода.';
            } else {
                userMessage = `Ошибка API: ${errorMessage}`;
            }
        } else if (error.code === 'ECONNABORTED') {
            userMessage = 'Превышено время ожидания ответа от AI. Код слишком большой? Попробуйте отправить меньшую часть.';
        } else if (error.message) {
            userMessage = `Ошибка: ${error.message}`;
        }
        
        res.status(500).json({ 
            error: errorMessage,
            analysis: `⚠️ **Ошибка анализа кода**\n\n${userMessage}\n\nПопробуйте:\n- Отправить код меньшего размера\n- Проверить подключение к интернету\n- Повторить попытку позже`
        });
    }
});

// ============================================
// ГОЛОСОВОЙ ПРОЦЕСС
// ============================================

app.post('/api/voice/process', upload.single('voice'), async (req, res) => {
    console.log('🎤 Голосовой запрос получен');
    
    const text = req.body.text || '';
    
    if (req.file) {
        try {
            fs.unlinkSync(req.file.path);
        } catch (e) {}
    }
    
    if (text) {
        res.json({
            success: true,
            recognized_text: text,
            answer: `Вы сказали: "${text}". Как я могу помочь?`
        });
        return;
    }
    
    res.json({
        success: true,
        recognized_text: '',
        answer: 'Голосовое сообщение получено. Функция полного распознавания в разработке.'
    });
});

// Удалить сессию
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
// СТАТИЧЕСКИЕ ФАЙЛЫ И FALLBACK
// ============================================

// Корневой маршрут
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Обработка 404 для API
app.get('/api/*', (req, res) => {
    res.status(404).json({ error: `API endpoint not found: ${req.originalUrl}` });
});

// Для всех остальных маршрутов - отдаем index.html (SPA)
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
║     🤖 Модель: ${process.env.DEFAULT_MODEL || 'deepseek-chat'}                               ║
║     🔑 API Key: ${process.env.DEEPSEEK_API_KEY && process.env.DEEPSEEK_API_KEY !== 'your_api_key_here' ? '✅ установлен' : '❌ не установлен'}           ║
║     💾 Активных сессий: ${sessions.size}                                                  ║
║                                                                  ║
║     🚀 Готов к работе!                                           ║
║     📍 http://localhost:${PORT}                                           ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝
    `);
});

module.exports = app;
