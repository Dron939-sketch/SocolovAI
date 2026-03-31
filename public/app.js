// ============================================
// СОКОЛОВ AI - ПОЛНЫЙ КЛИЕНТСКИЙ КОД
// С поддержкой двух моделей: DeepSeek-Chat и DeepSeek-Coder
// ============================================

(function() {
    'use strict';

    // ============================================
    // СОСТОЯНИЕ ПРИЛОЖЕНИЯ
    // ============================================
    
    let currentSessionId = null;
    let chats = [];
    let isTyping = false;
    let currentAbortController = null;
    let currentStreamingMessage = null;
    let isStreaming = false;
    let voiceManager = null;
    let currentModel = 'deepseek-chat';
    
    // Конфигурация моделей
    const MODELS = {
        'deepseek-chat': {
            name: 'Соколов AI',
            shortName: 'Общий',
            icon: '🧠',
            description: 'Универсальный помощник для любых вопросов',
            temperature: 1.0,
            systemPrompt: 'Ты — Соколов AI, интеллектуальный помощник на базе DeepSeek. Отвечай на русском языке, будь полезным, дружелюбным и профессиональным.'
        },
        'deepseek-coder-6.7b-instruct': {
            name: 'DeepSeek-Coder',
            shortName: 'Программист',
            icon: '💻',
            description: 'Специализирован на написании и анализе кода',
            temperature: 0.3,
            systemPrompt: 'Ты — DeepSeek-Coder, эксперт по программированию. Помогай писать, анализировать и оптимизировать код. Отвечай на русском языке, используй markdown для форматирования кода. Всегда приводи примеры кода, когда это уместно.'
        }
    };
    
    // DOM элементы
    const sidebar = document.getElementById('sidebar');
    const menuToggle = document.getElementById('menuToggle');
    const newChatBtn = document.getElementById('newChatBtn');
    const clearChatBtn = document.getElementById('clearChatBtn');
    const chatsList = document.getElementById('chatsList');
    const messagesList = document.getElementById('messagesList');
    const welcomeScreen = document.getElementById('welcomeScreen');
    const messageInput = document.getElementById('messageInput');
    const sendBtn = document.getElementById('sendBtn');
    const modelSelect = document.getElementById('modelSelect');
    const attachFileBtn = document.getElementById('attachFileBtn');
    const fileInput = document.getElementById('fileInput');
    const clearInputBtn = document.getElementById('clearInputBtn');
    const statusBadge = document.getElementById('statusBadge');
    const stopBtn = document.getElementById('stopBtn');
    const modelIndicator = document.getElementById('modelIndicator');
    const modelIndicatorIcon = document.getElementById('modelIndicatorIcon');
    const modelIndicatorText = document.getElementById('modelIndicatorText');
    const welcomeIcon = document.getElementById('welcomeIcon');
    const welcomeText = document.getElementById('welcomeText');
    const typingText = document.getElementById('typingText');
    const modelDescription = document.getElementById('modelDescription');
    const modelBadge = document.getElementById('modelBadge');
    
    // ============================================
    // УПРАВЛЕНИЕ МОДЕЛЯМИ
    // ============================================
    
    function updateModelUI() {
        const modelConfig = MODELS[currentModel];
        if (!modelConfig) return;
        
        // Обновляем индикатор в хедере
        if (modelIndicatorIcon) modelIndicatorIcon.textContent = modelConfig.icon;
        if (modelIndicatorText) modelIndicatorText.textContent = modelConfig.shortName + ' режим';
        
        // Обновляем приветственный экран
        if (welcomeIcon) welcomeIcon.textContent = modelConfig.icon;
        if (welcomeText) welcomeText.textContent = modelConfig.description;
        
        // Обновляем текст индикатора печати
        if (typingText) typingText.textContent = modelConfig.name + ' думает...';
        
        // Обновляем описание в сайдбаре
        if (modelDescription) modelDescription.textContent = modelConfig.description;
        
        // Обновляем бейдж
        if (modelBadge) modelBadge.textContent = modelConfig.name;
        
        // Сохраняем выбор
        localStorage.setItem('sokolov_model', currentModel);
        
        console.log(`🔄 Модель изменена: ${modelConfig.name} (${currentModel})`);
    }
    
    function switchModel(modelId) {
        if (MODELS[modelId]) {
            currentModel = modelId;
            updateModelUI();
            
            // Показываем уведомление
            showToast(`Переключено на ${MODELS[modelId].name}`, 'info');
        }
    }
    
    // ============================================
    // ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
    // ============================================
    
    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    function formatDate(dateString) {
        const date = new Date(dateString);
        const now = new Date();
        const diff = now - date;
        
        if (diff < 24 * 60 * 60 * 1000) {
            return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        } else if (diff < 7 * 24 * 60 * 60 * 1000) {
            return date.toLocaleDateString('ru-RU', { weekday: 'short' });
        } else {
            return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
        }
    }
    
    function showToast(message, type = 'info') {
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
    }
    
    function updateStatus(status, message) {
        if (!statusBadge) return;
        
        const dot = statusBadge.querySelector('.status-dot');
        const textSpan = statusBadge.querySelector('span:last-child');
        
        if (dot) {
            dot.style.background = status === 'error' ? 'var(--error)' : 
                                   status === 'thinking' ? 'var(--warning)' : 
                                   'var(--success)';
        }
        
        if (textSpan) {
            textSpan.textContent = message;
        }
    }
    
    function scrollToBottom() {
        setTimeout(() => {
            const container = document.querySelector('.messages-container');
            if (container) {
                container.scrollTop = container.scrollHeight;
            }
        }, 50);
    }
    
    function showTypingIndicator() {
        const indicator = document.getElementById('typingIndicator');
        if (indicator) {
            indicator.style.display = 'flex';
            scrollToBottom();
        }
    }
    
    function hideTypingIndicator() {
        const indicator = document.getElementById('typingIndicator');
        if (indicator) {
            indicator.style.display = 'none';
        }
    }
    
    function adjustTextareaHeight() {
        if (messageInput) {
            messageInput.style.height = 'auto';
            messageInput.style.height = Math.min(messageInput.scrollHeight, 200) + 'px';
        }
    }
    
    // ============================================
    // УПРАВЛЕНИЕ КНОПКОЙ STOP
    // ============================================
    
    function showStopButton() {
        if (stopBtn) stopBtn.style.display = 'flex';
        if (sendBtn) sendBtn.style.display = 'none';
    }
    
    function hideStopButton() {
        if (stopBtn) stopBtn.style.display = 'none';
        if (sendBtn) sendBtn.style.display = 'flex';
    }
    
    function stopGeneration() {
        if (currentAbortController) {
            currentAbortController.abort();
            currentAbortController = null;
            isStreaming = false;
            
            if (currentStreamingMessage && currentStreamingMessage.innerText) {
                const content = currentStreamingMessage.innerText;
                if (content && content.trim()) {
                    const chat = chats.find(c => c.id === currentSessionId);
                    if (chat) {
                        chat.messages.push({
                            id: Date.now().toString(),
                            role: 'assistant',
                            content: content + '\n\n*[Ответ прерван пользователем]*',
                            timestamp: new Date().toISOString()
                        });
                        saveChats();
                    }
                }
            }
            
            hideStopButton();
            hideTypingIndicator();
            updateStatus('ready', 'Готов к работе');
            showToast('Генерация ответа остановлена', 'info');
        }
    }
    
    // ============================================
    // ФОРМАТИРОВАНИЕ СООБЩЕНИЙ
    // ============================================
    
    function formatMessageWithCode(content) {
        if (!content) return '';
        
        let formatted = content;
        
        formatted = formatted.replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang, code) => {
            const language = lang || 'plaintext';
            const escapedCode = escapeHtml(code.trim());
            
            return `
                <div class="code-block-wrapper">
                    <div class="code-header">
                        <span class="code-language">${escapeHtml(language)}</span>
                        <button class="copy-code-btn" data-code="${escapedCode.replace(/"/g, '&quot;')}" onclick="window.copyCodeBlock(this)">
                            <i class="fas fa-copy"></i>
                            <span>Копировать код</span>
                        </button>
                    </div>
                    <pre><code class="language-${language}">${escapedCode}</code></pre>
                </div>
            `;
        });
        
        formatted = formatted.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
        formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        formatted = formatted.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
        formatted = formatted.replace(/^### (.*$)/gm, '<h3>$1</h3>');
        formatted = formatted.replace(/^## (.*$)/gm, '<h2>$1</h2>');
        formatted = formatted.replace(/^# (.*$)/gm, '<h1>$1</h1>');
        formatted = formatted.replace(/^- (.*$)/gm, '<li>$1</li>');
        formatted = formatted.replace(/^\* (.*$)/gm, '<li>$1</li>');
        formatted = formatted.replace(/\n/g, '<br>');
        
        return formatted;
    }
    
    window.copyCodeBlock = async function(button) {
        const code = button.getAttribute('data-code');
        if (!code) {
            showToast('Не удалось скопировать код', 'error');
            return;
        }
        
        try {
            await navigator.clipboard.writeText(code);
            const originalHTML = button.innerHTML;
            button.innerHTML = '<i class="fas fa-check"></i><span>Скопировано!</span>';
            button.classList.add('copied');
            
            setTimeout(() => {
                button.innerHTML = originalHTML;
                button.classList.remove('copied');
            }, 2000);
            
            showToast('Код скопирован', 'success');
        } catch (err) {
            const textarea = document.createElement('textarea');
            textarea.value = code;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            showToast('Код скопирован', 'success');
        }
    };
    
    // ============================================
    // УПРАВЛЕНИЕ ЧАТАМИ
    // ============================================
    
    function loadChats() {
        const saved = localStorage.getItem('sokolov_chats');
        if (saved) {
            chats = JSON.parse(saved);
        } else {
            chats = [];
        }
        
        // Загружаем сохранённую модель
        const savedModel = localStorage.getItem('sokolov_model');
        if (savedModel && MODELS[savedModel]) {
            currentModel = savedModel;
            if (modelSelect) modelSelect.value = savedModel;
        }
        updateModelUI();
    }
    
    function saveChats() {
        localStorage.setItem('sokolov_chats', JSON.stringify(chats));
    }
    
    function renderChatsList() {
        if (!chatsList) return;
        
        if (chats.length === 0) {
            chatsList.innerHTML = `
                <div class="empty-chats">
                    <i class="fas fa-comments"></i>
                    <p>Нет чатов</p>
                    <span>Начните новый диалог</span>
                </div>
            `;
            return;
        }
        
        chatsList.innerHTML = chats.map(chat => `
            <div class="chat-item ${chat.id === currentSessionId ? 'active' : ''}" data-chat-id="${chat.id}">
                <div class="chat-icon">
                    <i class="fas fa-message"></i>
                </div>
                <div class="chat-info">
                    <div class="chat-title">${escapeHtml(chat.title || 'Новый чат')}</div>
                    <div class="chat-preview">${escapeHtml(chat.messages[chat.messages.length - 1]?.content?.substring(0, 50) || 'Новый чат')}</div>
                </div>
                <div class="chat-date">${formatDate(chat.createdAt)}</div>
                <button class="chat-delete" data-id="${chat.id}"><i class="fas fa-times"></i></button>
            </div>
        `).join('');
        
        document.querySelectorAll('.chat-item').forEach(el => {
            el.addEventListener('click', (e) => {
                if (!e.target.closest('.chat-delete')) {
                    loadSession(el.dataset.chatId);
                }
            });
        });
        
        document.querySelectorAll('.chat-delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                deleteChat(id);
            });
        });
    }
    
    function deleteChat(chatId) {
        chats = chats.filter(c => c.id !== chatId);
        saveChats();
        
        if (chatId === currentSessionId) {
            createNewSession();
        } else {
            renderChatsList();
        }
    }
    
    function updateChatTitle(sessionId, firstMessage) {
        const chat = chats.find(c => c.id === sessionId);
        if (chat && chat.title === 'Новый чат') {
            const title = firstMessage.length > 30 ? firstMessage.substring(0, 30) + '...' : firstMessage;
            chat.title = title;
            saveChats();
            renderChatsList();
        }
    }
    
    function clearMessages() {
        if (messagesList) {
            messagesList.innerHTML = '';
        }
    }
    
    function addMessage(role, content, save = true) {
        const message = {
            id: Date.now().toString(),
            role: role,
            content: content,
            timestamp: new Date().toISOString()
        };
        
        const formattedContent = role === 'bot' ? formatMessageWithCode(content) : escapeHtml(content).replace(/\n/g, '<br>');
        
        const messageHtml = `
            <div class="message ${role === 'user' ? 'user' : 'bot'}">
                <div class="message-avatar">
                    ${role === 'user' ? '<i class="fas fa-user"></i>' : MODELS[currentModel]?.icon || '🤖'}
                </div>
                <div class="message-content">
                    <div class="message-bubble">
                        ${formattedContent}
                    </div>
                </div>
            </div>
        `;
        
        if (messagesList) {
            messagesList.insertAdjacentHTML('beforeend', messageHtml);
            scrollToBottom();
        }
        
        if (save && role === 'user') {
            const chat = chats.find(c => c.id === currentSessionId);
            if (chat) {
                chat.messages.push(message);
                saveChats();
            }
        }
        
        return message;
    }
    
    // ============================================
    // API ЗАПРОСЫ
    // ============================================
    
    async function createNewSession() {
        try {
            const response = await fetch('/api/session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            
            const data = await response.json();
            currentSessionId = data.sessionId;
            
            localStorage.setItem('sokolov_current_session', currentSessionId);
            
            const newChat = {
                id: currentSessionId,
                title: 'Новый чат',
                createdAt: new Date().toISOString(),
                messages: [],
                model: currentModel
            };
            
            chats.unshift(newChat);
            saveChats();
            renderChatsList();
            clearMessages();
            
            welcomeScreen.style.display = 'flex';
            messagesList.style.display = 'none';
            
            return currentSessionId;
        } catch (error) {
            console.error('Ошибка создания сессии:', error);
            updateStatus('error', 'Ошибка подключения');
            showToast('Не удалось создать сессию. Проверьте подключение к серверу.', 'error');
            return null;
        }
    }
    
    async function loadSession(sessionId) {
        if (currentSessionId === sessionId) return;
        
        currentSessionId = sessionId;
        localStorage.setItem('sokolov_current_session', sessionId);
        
        try {
            const response = await fetch(`/api/chat/${sessionId}`);
            const data = await response.json();
            
            const chat = chats.find(c => c.id === sessionId);
            if (chat) {
                chat.messages = data.messages;
                saveChats();
            }
            
            clearMessages();
            if (data.messages && data.messages.length > 0) {
                data.messages.forEach(msg => {
                    addMessage(msg.role, msg.content, false);
                });
                welcomeScreen.style.display = 'none';
                messagesList.style.display = 'block';
            } else {
                welcomeScreen.style.display = 'flex';
                messagesList.style.display = 'none';
            }
            
            renderChatsList();
            
        } catch (error) {
            console.error('Ошибка загрузки сессии:', error);
        }
    }
    
    // ============================================
    // ОТПРАВКА СООБЩЕНИЙ
    // ============================================
    
    async function sendMessageWithStream(message) {
        if (currentAbortController) {
            currentAbortController.abort();
        }
        
        currentAbortController = new AbortController();
        isStreaming = true;
        
        const timeoutId = setTimeout(() => {
            if (currentAbortController) {
                currentAbortController.abort();
                hideStopButton();
                addMessage('bot', '⏰ Превышено время ожидания ответа. Попробуйте еще раз.');
                isStreaming = false;
                updateStatus('ready', 'Готов к работе');
            }
        }, 300000);
        
        try {
            console.log(`📡 Отправка стриминг-запроса с моделью: ${currentModel}`);
            
            const response = await fetch(`/api/chat/${currentSessionId}/stream`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: message,
                    model: currentModel,
                    temperature: MODELS[currentModel].temperature
                }),
                signal: currentAbortController.signal
            });
            
            if (!response.ok) {
                await sendMessageRegular(message);
                return;
            }
            
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            
            let botMessageElement = null;
            let fullResponse = '';
            
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                const chunk = decoder.decode(value);
                const lines = chunk.split('\n');
                
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6);
                        if (data === '[DONE]') continue;
                        
                        try {
                            const parsed = JSON.parse(data);
                            if (parsed.content) {
                                fullResponse += parsed.content;
                                
                                if (!botMessageElement) {
                                    const messageHtml = `
                                        <div class="message bot">
                                            <div class="message-avatar">
                                                ${MODELS[currentModel].icon}
                                            </div>
                                            <div class="message-content">
                                                <div class="message-bubble" id="streamingMessage"></div>
                                            </div>
                                        </div>
                                    `;
                                    messagesList.insertAdjacentHTML('beforeend', messageHtml);
                                    botMessageElement = document.getElementById('streamingMessage');
                                    currentStreamingMessage = botMessageElement;
                                    scrollToBottom();
                                }
                                
                                if (botMessageElement) {
                                    botMessageElement.innerHTML = formatMessageWithCode(fullResponse);
                                    scrollToBottom();
                                }
                            }
                            
                            if (parsed.done) {
                                const chat = chats.find(c => c.id === currentSessionId);
                                if (chat) {
                                    chat.messages.push({
                                        id: Date.now().toString(),
                                        role: 'assistant',
                                        content: fullResponse,
                                        timestamp: new Date().toISOString()
                                    });
                                    saveChats();
                                }
                                currentStreamingMessage = null;
                            }
                            
                        } catch (e) {}
                    }
                    
                    if (line.startsWith('event: done')) break;
                    if (line.startsWith('event: error')) {
                        throw new Error('Ошибка потока данных');
                    }
                }
            }
            
        } catch (error) {
            console.error('Stream error:', error);
            if (error.name !== 'AbortError') {
                await sendMessageRegular(message);
            }
        } finally {
            clearTimeout(timeoutId);
            currentAbortController = null;
            isStreaming = false;
            hideStopButton();
            currentStreamingMessage = null;
        }
    }
    
    async function sendMessageRegular(message) {
        try {
            console.log(`📡 Отправка обычного запроса с моделью: ${currentModel}`);
            
            const response = await fetch(`/api/chat/${currentSessionId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: message,
                    model: currentModel,
                    temperature: MODELS[currentModel].temperature
                })
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const data = await response.json();
            
            if (data.message) {
                addMessage('bot', data.message.content);
                const chat = chats.find(c => c.id === currentSessionId);
                if (chat) {
                    chat.messages.push(data.message);
                    saveChats();
                }
            } else if (data.error) {
                addMessage('bot', `⚠️ Ошибка: ${data.error}`);
            } else {
                addMessage('bot', '⚠️ Не удалось получить ответ.');
            }
            
        } catch (error) {
            console.error('Regular chat error:', error);
            addMessage('bot', '⚠️ Ошибка соединения. Попробуйте позже.');
        }
    }
    
    async function sendMessage() {
        const message = messageInput.value.trim();
        if (!message || isTyping || isStreaming) return;
        
        messageInput.value = '';
        adjustTextareaHeight();
        
        welcomeScreen.style.display = 'none';
        messagesList.style.display = 'block';
        
        addMessage('user', message);
        updateChatTitle(currentSessionId, message);
        
        showTypingIndicator();
        isTyping = true;
        updateStatus('thinking', 'Думаю...');
        showStopButton();
        
        try {
            await sendMessageWithStream(message);
        } catch (error) {
            console.error('Ошибка отправки:', error);
            addMessage('bot', '⚠️ Извините, произошла ошибка. Пожалуйста, попробуйте позже.');
            updateStatus('error', 'Ошибка');
        } finally {
            hideTypingIndicator();
            isTyping = false;
            updateStatus('ready', 'Готов к работе');
            hideStopButton();
        }
    }
    
    // ============================================
    // АНАЛИЗ ФАЙЛОВ
    // ============================================
    
    async function readFileContent(file) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const content = e.target.result;
                resolve(content.length > 2000 ? content.substring(0, 2000) + '\n... (файл обрезан)' : content);
            };
            reader.readAsText(file);
        });
    }
    
    async function sendFile(file) {
        if (!file) return;
        
        const formData = new FormData();
        formData.append('file', file);
        formData.append('language', file.name.split('.').pop());
        formData.append('sessionId', currentSessionId);
        
        welcomeScreen.style.display = 'none';
        messagesList.style.display = 'block';
        
        const fileContent = await readFileContent(file);
        addMessage('user', `📁 Загружен файл: ${file.name}\n\n\`\`\`${file.name.split('.').pop()}\n${fileContent}\n\`\`\``);
        
        showTypingIndicator();
        isTyping = true;
        updateStatus('thinking', 'Анализирую код...');
        
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 120000);
            
            const response = await fetch('/api/analyze-code', {
                method: 'POST',
                body: formData,
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const data = await response.json();
            
            hideTypingIndicator();
            addMessage('bot', data.analysis || 'Анализ завершен.');
            
        } catch (error) {
            console.error('Ошибка анализа:', error);
            hideTypingIndicator();
            addMessage('bot', '⚠️ Не удалось проанализировать файл. Попробуйте еще раз.');
        } finally {
            isTyping = false;
            updateStatus('ready', 'Готов к работе');
        }
    }
    
    // ============================================
    // ТЕМА ОФОРМЛЕНИЯ
    // ============================================
    
    class ThemeManager {
        constructor() {
            this.currentTheme = localStorage.getItem('sokolov_theme') || 'light';
            this.themeToggle = document.getElementById('themeToggle');
            this.init();
        }
        
        init() {
            this.applyTheme(this.currentTheme);
            this.updateIcon(this.currentTheme);
            
            if (this.themeToggle) {
                this.themeToggle.addEventListener('click', () => this.toggleTheme());
            }
        }
        
        applyTheme(theme) {
            document.documentElement.setAttribute('data-theme', theme);
            localStorage.setItem('sokolov_theme', theme);
            this.currentTheme = theme;
        }
        
        toggleTheme() {
            const newTheme = this.currentTheme === 'dark' ? 'light' : 'dark';
            this.applyTheme(newTheme);
            this.updateIcon(newTheme);
            showToast(`Тема: ${newTheme === 'dark' ? 'тёмная' : 'светлая'}`, 'info');
        }
        
        updateIcon(theme) {
            if (!this.themeToggle) return;
            const icon = this.themeToggle.querySelector('i');
            if (icon) {
                icon.className = theme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
            }
        }
    }
    
    // ============================================
    // ГОЛОСОВОЙ МОДУЛЬ
    // ============================================
    
    function initVoice() {
        if (typeof window.VoiceManager !== 'undefined') {
            voiceManager = new window.VoiceManager();
            
            voiceManager.onTranscript = (text) => {
                if (messageInput) {
                    messageInput.value = text;
                    adjustTextareaHeight();
                    setTimeout(() => {
                        if (messageInput.value.trim()) {
                            sendMessage();
                        }
                    }, 500);
                }
            };
            
            voiceManager.onError = (error) => {
                showToast(error, 'error');
            };
            
            voiceManager.onRecordingStart = () => {
                const voiceBtn = document.getElementById('recordVoiceBtn');
                if (voiceBtn) voiceBtn.classList.add('recording');
            };
            
            voiceManager.onRecordingStop = () => {
                const voiceBtn = document.getElementById('recordVoiceBtn');
                if (voiceBtn) voiceBtn.classList.remove('recording');
            };
            
            console.log('🎤 Голосовой модуль инициализирован');
        }
    }
    
    function addVoiceButton() {
        const inputTools = document.querySelector('.input-tools');
        if (inputTools && !document.getElementById('recordVoiceBtn')) {
            const voiceBtn = document.createElement('button');
            voiceBtn.id = 'recordVoiceBtn';
            voiceBtn.className = 'tool-btn voice-btn';
            voiceBtn.innerHTML = '<i class="fas fa-microphone"></i>';
            voiceBtn.title = 'Голосовой ввод';
            voiceBtn.onclick = () => {
                if (voiceManager) {
                    if (voiceManager.isRecordingActive()) {
                        voiceManager.stopRecording();
                    } else {
                        voiceManager.startRecording();
                    }
                } else {
                    showToast('Голосовой модуль загружается...', 'info');
                }
            };
            
            const clearBtn = document.getElementById('clearInputBtn');
            if (clearBtn) {
                inputTools.insertBefore(voiceBtn, clearBtn);
            } else {
                inputTools.appendChild(voiceBtn);
            }
        }
    }
    
    // ============================================
    // ИНИЦИАЛИЗАЦИЯ
    // ============================================
    
    async function init() {
        console.log('🦅 Соколов AI инициализация...');
        
        loadChats();
        
        const savedSession = localStorage.getItem('sokolov_current_session');
        if (savedSession && chats.find(c => c.id === savedSession)) {
            await loadSession(savedSession);
        } else {
            await createNewSession();
        }
        
        setupEventListeners();
        
        window.themeManager = new ThemeManager();
        
        setTimeout(() => {
            initVoice();
            addVoiceButton();
        }, 1000);
        
        updateStatus('ready', 'Готов к работе');
        console.log('✅ Соколов AI готов');
    }
    
    function setupEventListeners() {
        sendBtn?.addEventListener('click', sendMessage);
        stopBtn?.addEventListener('click', stopGeneration);
        
        messageInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
        
        messageInput?.addEventListener('input', adjustTextareaHeight);
        
        newChatBtn?.addEventListener('click', async () => {
            if (isStreaming) stopGeneration();
            await createNewSession();
        });
        
        clearChatBtn?.addEventListener('click', () => {
            if (confirm('Очистить текущий чат?')) {
                if (isStreaming) stopGeneration();
                clearMessages();
                const chat = chats.find(c => c.id === currentSessionId);
                if (chat) {
                    chat.messages = [];
                    saveChats();
                }
                welcomeScreen.style.display = 'flex';
                messagesList.style.display = 'none';
                renderChatsList();
            }
        });
        
        menuToggle?.addEventListener('click', () => {
            sidebar?.classList.toggle('open');
        });
        
        document.addEventListener('click', (e) => {
            if (sidebar?.classList.contains('open')) {
                if (!sidebar.contains(e.target) && !menuToggle?.contains(e.target)) {
                    sidebar.classList.remove('open');
                }
            }
        });
        
        attachFileBtn?.addEventListener('click', () => {
            fileInput?.click();
        });
        
        fileInput?.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                sendFile(e.target.files[0]);
                fileInput.value = '';
            }
        });
        
        clearInputBtn?.addEventListener('click', () => {
            messageInput.value = '';
            adjustTextareaHeight();
        });
        
        modelSelect?.addEventListener('change', (e) => {
            switchModel(e.target.value);
        });
        
        document.querySelectorAll('.suggestion-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const prompt = btn.dataset.prompt;
                if (prompt) {
                    messageInput.value = prompt;
                    sendMessage();
                }
            });
        });
    }
    
    // Запуск
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
    
})();
