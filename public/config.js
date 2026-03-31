// ============================================
// СОКОЛОВ AI - КОНФИГУРАЦИЯ
// ============================================

window.CONFIG = {
    // API endpoints
    API: {
        CHAT: '/api/chat',
        SESSION: '/api/session',
        ANALYZE_CODE: '/api/analyze-code',
        VOICE_PROCESS: '/api/voice/process',
        HEALTH: '/api/health'
    },
    
    // Доступные модели
    MODELS: {
        'deepseek-chat': {
            id: 'deepseek-chat',
            name: 'Соколов AI',
            shortName: 'Общий',
            icon: '🧠',
            description: 'Универсальный помощник для любых вопросов',
            temperature: 1.0,
            color: '#10a37f'
        },
        'deepseek-coder-6.7b-instruct': {
            id: 'deepseek-coder-6.7b-instruct',
            name: 'DeepSeek-Coder',
            shortName: 'Программист',
            icon: '💻',
            description: 'Специализирован на написании и анализе кода',
            temperature: 0.3,
            color: '#e67e22'
        }
    },
    
    // Настройки приложения
    APP: {
        name: 'Соколов AI',
        version: '2.0.0',
        debug: true,
        maxMessageLength: 4000,
        maxFileSize: 50 * 1024 * 1024,
        allowedFileTypes: ['.js', '.py', '.html', '.css', '.json', '.txt', '.md', '.ts', '.jsx', '.tsx', '.c', '.cpp', '.java', '.go', '.rs']
    },
    
    // Настройки AI
    AI: {
        defaultModel: 'deepseek-chat',
        coderModel: 'deepseek-coder-6.7b-instruct',
        maxTokens: 16384
    },
    
    // Настройки UI
    UI: {
        theme: 'light',
        animations: true,
        autoScroll: true,
        messageLimit: 100
    },
    
    // Настройки голоса
    VOICE: {
        enabled: true,
        autoStopSilence: true,
        silenceTimeout: 2000,
        maxDuration: 30000,
        minDuration: 500
    }
};

// Определение системной темы
if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    if (!localStorage.getItem('sokolov_theme')) {
        document.documentElement.setAttribute('data-theme', 'dark');
    }
}
