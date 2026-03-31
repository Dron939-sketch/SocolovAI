// ============================================
// СОКОЛОВ AI - СЕРВЕР С ПОДДЕРЖКОЙ БОЛЬШИХ ФАЙЛОВ
// 200,000 символов, увеличенные таймауты
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
// УВЕЛИЧЕННЫЕ ЛИМИТЫ
// ============================================

// Увеличиваем лимиты для Express (200MB для больших файлов)
app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ extended: true, limit: '200mb' }));

// Увеличиваем таймаут сервера (10 минут для больших файлов)
app.use((req, res, next) => {
    req.setTimeout(600000); // 10 минут
    res.setTimeout(600000);
    next();
});

// ============================================
// НАСТРОЙКА ЗАГРУЗКИ ФАЙЛОВ (200MB)
// ============================================

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({ 
    dest: uploadDir,
    limits: { fileSize: 200 * 1024 * 1024 } // 200MB
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
// ОСНОВНОЙ ЧАТ - С ПОДДЕРЖКОЙ БОЛЬШИХ СООБЩЕНИЙ
// ============================================

app.post('/api/chat/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    const { message, model = 'deepseek-chat', temperature = 0.7 } = req.body;
    
    console.log(`💬 Запрос для ${sessionId}: ${message?.substring(0, 100)}...`);
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
    
    // Ограничиваем историю для больших сообщений (последние 10 сообщений)
    const recentMessages = session.messages.slice(-10);
    
    const messages = [
        { role: 'system', content: process.env.SYSTEM_PROMPT || 'Ты — Соколов AI, полезный помощник. Отвечай на русском языке, будь дружелюбным и профессиональным.' },
        ...recentMessages.map(m => ({ role: m.role, content: m.content }))
    ];
    
    // Подсчет токенов (приблизительный)
    const estimatedTokens = JSON.stringify(messages).length / 3;
    console.log(`📊 Примерное количество токенов: ${Math.round(estimatedTokens)}`);
    
    // Таймаут: 2 минуты на каждые 10,000 токенов, но не более 10 минут
    const timeoutMs = Math.min(600000, Math.max(120000, estimatedTokens * 6));
    console.log(`⏰ Таймаут: ${Math.round(timeoutMs / 1000)} секунд`);
    
    try {
        console.log(`📤 Отправка запроса в DeepSeek API...`);
        const startTime = Date.now();
        
        const response = await axios.post(process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions', {
            model: model,
            messages: messages,
            max_tokens: 16384, // 16K токенов на ответ
            temperature: parseFloat(temperature)
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
        
        let errorMessage = '⚠️ Произошла ошибка.';
        
        if (error.code === 'ECONNABORTED') {
            errorMessage = `⏰ Превышено время ожидания (${Math.round(timeoutMs / 1000)} сек).\n\nВаш запрос слишком большой. Попробуйте:\n- Отправить код частями\n- Уменьшить размер сообщения\n- Использовать более низкую температуру (0.3-0.5) для ускорения`;
        } else if (error.response?.status === 429) {
            errorMessage = '📊 Слишком много запросов. Подождите 30 секунд и попробуйте снова.';
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
// АНАЛИЗ КОДА - 200,000 СИМВОЛОВ
// ============================================

app.post('/api/analyze-code', upload.single('file'), async (req, res) => {
    console.log('🔍 Анализ кода');
    
    let codeContent = req.body.code;
    let language = req.body.language || 'javascript';
    let temperature = parseFloat(req.body.temperature) || 0.3;
    
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
    
    // НОВЫЙ ЛИМИТ: 200,000 символов
    const MAX_CODE_LENGTH = 200000;
    let wasTruncated = false;
    let originalLength = codeContent.length;
    
    if (codeContent.length > MAX_CODE_LENGTH) {
        codeContent = codeContent.substring(0, MAX_CODE_LENGTH) + '\n\n... [КОД ОБРЕЗАН: было ' + originalLength + ' символов, оставлено ' + MAX_CODE_LENGTH + ']';
        wasTruncated = true;
        console.log(`✂️ Код обрезан: ${originalLength} -> ${MAX_CODE_LENGTH} символов`);
    }
    
    const linesCount = codeContent.split('\n').length;
    console.log(`📊 Строк: ${linesCount}, Символов: ${codeContent.length}, Температура: ${temperature}`);
    
    const prompt = `Проанализируй этот код на ${language} (${linesCount} строк, ${codeContent.length} символов):

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

    // Таймаут: 5 минут на каждые 50,000 символов, но не более 15 минут
    const timeoutMs = Math.min(900000, Math.max(180000, (codeContent.length / 1000) * 30));
    console.log(`⏰ Таймаут анализа: ${Math.round(timeoutMs / 1000)} секунд`);
    
    try {
        console.log(`📤 Отправка запроса в DeepSeek API...`);
        const startTime = Date.now();
        
        const response = await axios.post(process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions', {
            model: 'deepseek-chat',
            messages: [
                { role: 'system', content: 'Ты эксперт по анализу кода с 10-летним опытом. Отвечай структурированно, используй markdown. Всегда отвечай на русском языке.' },
                { role: 'user', content: prompt }
            ],
            max_tokens: 16384,
            temperature: temperature
        }, {
            headers: { 'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}` },
            timeout: timeoutMs
        });
        
        const duration = Date.now() - startTime;
        console.log(`✅ Анализ завершен за ${duration}ms`);
        console.log(`📊 Использовано токенов: ${response.data.usage?.total_tokens || 'неизвестно'}`);
        
        const analysis = response.data.choices[0].message.content;
        const header = `📊 **Анализ кода**\n\n📁 ${req.file ? req.file.originalname : 'вставленный код'}\n📏 ${codeContent.length} символов\n📊 ${linesCount} строк\n🌡️ Температура: ${temperature}\n${wasTruncated ? '⚠️ Код был обрезан для анализа\n' : ''}\n---\n\n`;
        
        res.json({ 
            analysis: header + analysis,
            usage: response.data.usage,
            truncated: wasTruncated,
            originalSize: originalLength,
            processedSize: codeContent.length
        });
        
    } catch (error) {
        console.error('❌ Ошибка анализа:', error.code || error.message);
        
        let errorMessage = '⚠️ Не удалось проанализировать код.';
        if (error.code === 'ECONNABORTED') {
            errorMessage = `⏰ Превышено время ожидания (${Math.round(timeoutMs / 1000)} сек).\n\nКод слишком большой. Попробуйте:\n- Отправить код частями\n- Уменьшить размер файла\n- Использовать более низкую температуру (0.2-0.3)`;
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
║                                                                  ║
║     📏 Лимиты:                                                   ║
║        - Размер кода: до 200,000 символов                        ║
║        - Таймаут: до 15 минут                                    ║
║        - Max tokens ответа: 16,384                               ║
║        - Температура: 0.0 - 2.0 (по умолчанию 0.7)              ║
║                                                                  ║
║     🚀 Готов к работе!                                           ║
║     📍 http://localhost:${PORT}                                         ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝
    `);
});

module.exports = app;
