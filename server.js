// ============================================
// СОКОЛОВ AI - ПОЛНЫЙ СЕРВЕР
// Увеличенные таймауты, поддержка больших сообщений
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
// УВЕЛИЧЕНИЕ ТАЙМАУТОВ
// ============================================

// Увеличиваем лимиты для Express
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// Увеличиваем таймаут сервера
app.use((req, res, next) => {
    req.setTimeout(300000); // 5 минут
    res.setTimeout(300000);
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
    limits: { fileSize: 100 * 1024 * 1024 } // 100MB
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
// ОСНОВНОЙ ЧАТ - УВЕЛИЧЕННЫЕ ТАЙМАУТЫ
// ============================================

app.post('/api/chat/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    const { message, model = 'deepseek-chat', temperature = 0.7 } = req.body;
    
    console.log(`💬 Обычный запрос для ${sessionId}: ${message?.substring(0, 100)}...`);
    console.log(`📏 Длина сообщения: ${message?.length || 0} символов`);
    
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
    
    // Ограничиваем историю для больших сообщений (последние 20 сообщений)
    const recentMessages = session.messages.slice(-20);
    
    const messages = [
        { role: 'system', content: process.env.SYSTEM_PROMPT || 'Ты — Соколов AI, полезный помощник. Отвечай на русском языке, будь дружелюбным и профессиональным.' },
        ...recentMessages.map(m => ({ role: m.role, content: m.content }))
    ];
    
    // Подсчет токенов (приблизительный)
    const estimatedTokens = JSON.stringify(messages).length / 4;
    console.log(`📊 Примерное количество токенов: ${Math.round(estimatedTokens)}`);
    
    // Если сообщение слишком большое, отправляем предупреждение
    if (estimatedTokens > 100000) {
        console.log('⚠️ Сообщение слишком большое, отправляем предупреждение');
        const warningMessage = `⚠️ **Ваше сообщение очень большое** (примерно ${Math.round(estimatedTokens)} токенов).\n\nDeepSeek может не обработать его целиком. Рекомендую:\n- Отправить код частями\n- Выделить наиболее важные фрагменты\n- Или подождать — я попробую обработать, но это может занять время.`;
        
        const aiMessage = {
            id: uuidv4(),
            role: 'assistant',
            content: warningMessage,
            timestamp: new Date().toISOString()
        };
        session.messages.push(aiMessage);
        return res.json({ message: aiMessage });
    }
    
    try {
        console.log(`📤 Отправка запроса в DeepSeek API...`);
        const startTime = Date.now();
        
        // Увеличенный таймаут для больших сообщений
        const timeoutMs = Math.min(300000, Math.max(120000, estimatedTokens * 2)); // минимум 2 минуты, максимум 5 минут
        
        const response = await axios.post(process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions', {
            model: model,
            messages: messages,
            max_tokens: 8192, // Увеличиваем до 8K
            temperature: temperature
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: timeoutMs
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
        
        let errorMessage = '⚠️ Произошла ошибка при обращении к AI.';
        
        if (error.code === 'ECONNABORTED') {
            errorMessage = '⏰ Превышено время ожидания ответа от AI. Ваш запрос слишком сложный или длинный. Попробуйте:\n- Отправить код частями\n- Упростить запрос\n- Сократить сообщение';
        } else if (error.response?.status === 429) {
            errorMessage = '📊 Слишком много запросов. Подождите немного и попробуйте снова.';
        } else if (error.response?.status === 401) {
            errorMessage = '🔑 Ошибка авторизации API. Проверьте ключ DeepSeek API в настройках.';
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
// АНАЛИЗ КОДА (увеличенные таймауты)
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
    
    // Ограничиваем длину для API (100K символов)
    const MAX_CODE_LENGTH = 80000;
    let wasTruncated = false;
    let originalLength = codeContent.length;
    if (codeContent.length > MAX_CODE_LENGTH) {
        codeContent = codeContent.substring(0, MAX_CODE_LENGTH) + '\n... (код обрезан, было ' + originalLength + ' символов)';
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
        
        // Увеличенный таймаут для анализа кода (до 3 минут)
        const timeoutMs = Math.min(180000, Math.max(90000, codeContent.length / 1000 * 2));
        
        const response = await axios.post(process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions', {
            model: 'deepseek-chat',
            messages: [
                { role: 'system', content: 'Ты эксперт по анализу кода с 10-летним опытом. Отвечай структурированно, используй markdown. Всегда отвечай на русском языке.' },
                { role: 'user', content: prompt }
            ],
            max_tokens: 8192,
            temperature: 0.3
        }, {
            headers: { 'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}` },
            timeout: timeoutMs
        });
        
        const duration = Date.now() - startTime;
        console.log(`✅ Анализ завершен за ${duration}ms`);
        
        const analysis = response.data.choices[0].message.content;
        const header = `📊 **Анализ кода**\n\n📁 ${req.file ? req.file.originalname : 'вставленный код'}\n📏 ${codeContent.length} символов\n📊 ${codeContent.split('\n').length} строк\n${wasTruncated ? '⚠️ Код был обрезан для анализа\n' : ''}\n---\n\n`;
        
        res.json({ analysis: header + analysis });
        
    } catch (error) {
        console.error('❌ Ошибка анализа:', error.code || error.message);
        
        let errorMessage = '⚠️ Не удалось проанализировать код.';
        if (error.code === 'ECONNABORTED') {
            errorMessage = '⏰ Превышено время ожидания. Код слишком большой. Попробуйте:\n- Отправить код частями\n- Уменьшить размер файла';
        } else if (error.response?.status === 429) {
            errorMessage = '📊 Слишком много запросов. Подождите немного.';
        } else {
            errorMessage = `⚠️ Ошибка: ${error.message}`;
        }
        
        res.status(500).json({ error: errorMessage });
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

// Удаление сессии
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
║     ⏰ Таймаут запросов: до 5 минут                                ║
║                                                                  ║
║     🚀 Готов к работе!                                           ║
║     📍 http://localhost:${PORT}                                         ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝
    `);
});

module.exports = app;
