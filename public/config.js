// ============================================
// СОКОЛОВ AI - КОНФИГУРАЦИЯ
// ============================================

window.CONFIG = {
    // API endpoints (относительные пути для прокси через сервер)
    API: {
        CHAT: '/api/chat',
        SESSION: '/api/session',
        ANALYZE_CODE: '/api/analyze-code',
        VOICE_PROCESS: '/api/voice/process',
        HEALTH: '/api/health'
    },
    
    // Настройки приложения
    APP: {
        name: 'Соколов AI',
        version: '1.0.0',
        debug: true,
        maxMessageLength: 4000,
        maxFileSize: 5 * 1024 * 1024, // 5MB
        allowedFileTypes: ['.js', '.py', '.html', '.css', '.json', '.txt', '.md', '.ts', '.jsx', '.tsx']
    },
    
    // Настройки AI
    AI: {
        defaultModel: 'deepseek-chat',
        models: [
            { id: 'deepseek-chat', name: 'DeepSeek-V3.2', description: 'Универсальный' },
            { id: 'deepseek-coder', name: 'DeepSeek-Coder', description: 'Для программирования' }
        ],
        temperature: 0.7,
        maxTokens: 4096
    },
    
    // Настройки UI
    UI: {
        theme: 'dark',
        animations: true,
        autoScroll: true,
        messageLimit: 100,
        typingDelay: 500
    },
    
    // Настройки голоса
    VOICE: {
        enabled: true,
        autoStopSilence: true,
        silenceTimeout: 3000,
        maxDuration: 30000,
        minDuration: 500
    }
};

// Инициализация глобальных функций
window.copyToClipboard = function(text) {
    navigator.clipboard.writeText(text).then(() => {
        showToast('Скопировано в буфер обмена', 'success');
    }).catch(() => {
        showToast('Не удалось скопировать', 'error');
    });
};

window.showToast = function(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <i class="fas ${type === 'error' ? 'fa-exclamation-circle' : type === 'success' ? 'fa-check-circle' : 'fa-info-circle'}"></i>
        <span>${escapeHtml(message)}</span>
    `;
    toast.style.cssText = `
        position: fixed;
        bottom: 100px;
        left: 50%;
        transform: translateX(-50%);
        background: var(--bg-tertiary);
        border: 1px solid var(--border-color);
        border-radius: 12px;
        padding: 12px 20px;
        display: flex;
        align-items: center;
        gap: 10px;
        z-index: 10000;
        animation: slideUp 0.3s ease;
        backdrop-filter: blur(10px);
    `;
    
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'slideDown 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
};

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Добавляем CSS для анимаций
const style = document.createElement('style');
style.textContent = `
    @keyframes slideUp {
        from {
            opacity: 0;
            transform: translateX(-50%) translateY(20px);
        }
        to {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
        }
    }
    
    @keyframes slideDown {
        from {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
        }
        to {
            opacity: 0;
            transform: translateX(-50%) translateY(20px);
        }
    }
    
    .toast {
        box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3);
    }
    
    .toast-success i {
        color: var(--success);
    }
    
    .toast-error i {
        color: var(--error);
    }
    
    .toast-info i {
        color: var(--info);
    }
    
    .empty-chats {
        text-align: center;
        padding: 40px 20px;
        color: var(--text-secondary);
    }
    
    .empty-chats i {
        font-size: 48px;
        margin-bottom: 16px;
        opacity: 0.5;
    }
    
    .empty-chats p {
        margin-bottom: 8px;
    }
    
    .empty-chats span {
        font-size: 12px;
    }
    
    .message-usage {
        font-size: 10px;
        color: var(--text-muted);
        margin-top: 8px;
        text-align: right;
    }
    
    .chat-delete {
        background: none;
        border: none;
        color: var(--text-muted);
        cursor: pointer;
        padding: 4px;
        border-radius: 4px;
        opacity: 0;
        transition: all var(--transition-fast);
    }
    
    .chat-item:hover .chat-delete {
        opacity: 1;
    }
    
    .chat-delete:hover {
        color: var(--error);
        background: var(--bg-hover);
    }
`;

document.head.appendChild(style);
