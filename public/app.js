// ============================================
// СОКОЛОВ AI - КЛИЕНТСКАЯ ЛОГИКА
// ============================================

(function() {
    'use strict';

    // ============================================
    // СОСТОЯНИЕ ПРИЛОЖЕНИЯ
    // ============================================
    
    let currentSessionId = null;
    let chats = [];
    let isTyping = false;
    let currentStreamController = null;
    let voiceManager = null;
    
    // DOM элементы
    const sidebar = document.getElementById('sidebar');
    const menuToggle = document.getElementById('menuToggle');
    const newChatBtn = document.getElementById('newChatBtn');
    const clearChatBtn = document.getElementById('clearChatBtn');
    const chatsList = document.getElementById('chatsList');
    const messagesList = document.getElementById('messagesList');
    const welcomeScreen = document.getElementById('welcomeScreen');
    const typingIndicator = document.getElementById('typingIndicator');
    const messageInput = document.getElementById('messageInput');
    const sendBtn = document.getElementById('sendBtn');
    const modelSelect = document.getElementById('modelSelect');
    const attachFileBtn = document.getElementById('attachFileBtn');
    const fileInput = document.getElementById('fileInput');
    const recordVoiceBtn = document.getElementById('recordVoiceBtn');
    const clearInputBtn = document.getElementById('clearInputBtn');
    const statusBadge = document.getElementById('statusBadge');
    
    // ============================================
    // ИНИЦИАЛИЗАЦИЯ
    // ============================================
    
    async function init() {
        console.log('🦅 Соколов AI инициализация...');
        
        // Загружаем сохраненные чаты
        loadChats();
        
        // Создаем новую сессию
        await createNewSession();
        
        // Инициализируем голосовой модуль
        initVoice();
        
        // Настраиваем обработчики событий
        setupEventListeners();
        
        // Обновляем статус
        updateStatus('ready', 'Готов к работе');
        
        console.log('✅ Соколов AI готов');
    }
    
    // ============================================
    // УПРАВЛЕНИЕ СЕССИЯМИ
    // ============================================
    
    async function createNewSession() {
        try {
            const response = await fetch('/api/session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            
            const data = await response.json();
            currentSessionId = data.sessionId;
            
            // Сохраняем в localStorage
            localStorage.setItem('sokolov_current_session', currentSessionId);
            
            // Создаем локальный чат
            const newChat = {
                id: currentSessionId,
                title: 'Новый чат',
                createdAt: new Date().toISOString(),
                messages: []
            };
            
            chats.unshift(newChat);
            saveChats();
            renderChatsList();
            
            // Очищаем сообщения
            clearMessages();
            
            return currentSessionId;
        } catch (error) {
            console.error('Ошибка создания сессии:', error);
            updateStatus('error', 'Ошибка подключения');
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
            
            // Обновляем локальные сообщения
            const chat = chats.find(c => c.id === sessionId);
            if (chat) {
                chat.messages = data.messages;
                saveChats();
            }
            
            renderMessages(data.messages);
            
            // Скрываем welcome screen если есть сообщения
            if (data.messages.length > 0) {
                welcomeScreen.style.display = 'none';
                messagesList.style.display = 'block';
            } else {
                welcomeScreen.style.display = 'flex';
                messagesList.style.display = 'none';
            }
            
        } catch (error) {
            console.error('Ошибка загрузки сессии:', error);
        }
    }
    
    // ============================================
    // УПРАВЛЕНИЕ ЧАТАМИ (localStorage)
    // ============================================
    
    function loadChats() {
        const saved = localStorage.getItem('sokolov_chats');
        if (saved) {
            chats = JSON.parse(saved);
        } else {
            chats = [];
        }
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
        
        // Добавляем обработчики
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
    
    // ============================================
    // ОТОБРАЖЕНИЕ СООБЩЕНИЙ
    // ============================================
    
    function clearMessages() {
        if (messagesList) {
            messagesList.innerHTML = '';
        }
    }
    
    function renderMessages(messages) {
        if (!messagesList) return;
        
        if (!messages || messages.length === 0) {
            messagesList.innerHTML = '';
            return;
        }
        
        messagesList.innerHTML = messages.map(msg => `
            <div class="message ${msg.role === 'user' ? 'user' : 'bot'}">
                <div class="message-avatar">
                    ${msg.role === 'user' ? '<i class="fas fa-user"></i>' : '<i class="fas fa-robot"></i>'}
                </div>
                <div class="message-content">
                    <div class="message-bubble">
                        ${formatMessageContent(msg.content)}
                        ${msg.usage ? `<div class="message-usage">⚡ ${msg.usage.total_tokens} токенов</div>` : ''}
                    </div>
                </div>
            </div>
        `).join('');
        
        scrollToBottom();
    }
    
    function addMessage(role, content, save = true) {
        const message = {
            id: Date.now().toString(),
            role: role,
            content: content,
            timestamp: new Date().toISOString()
        };
        
        // Добавляем в DOM
        const messageHtml = `
            <div class="message ${role === 'user' ? 'user' : 'bot'}">
                <div class="message-avatar">
                    ${role === 'user' ? '<i class="fas fa-user"></i>' : '<i class="fas fa-robot"></i>'}
                </div>
                <div class="message-content">
                    <div class="message-bubble">
                        ${formatMessageContent(content)}
                    </div>
                </div>
            </div>
        `;
        
        messagesList.insertAdjacentHTML('beforeend', messageHtml);
        scrollToBottom();
        
        // Сохраняем на сервере
        if (save && role === 'user') {
            saveMessageToServer(message);
        }
        
        // Обновляем локальный чат
        const chat = chats.find(c => c.id === currentSessionId);
        if (chat) {
            chat.messages.push(message);
            saveChats();
        }
        
        return message;
    }
    
    async function saveMessageToServer(message) {
        try {
            // Сообщение уже сохранено на сервере при отправке
            // Этот метод для синхронизации
        } catch (error) {
            console.error('Ошибка сохранения:', error);
        }
    }
    
    function formatMessageContent(content) {
        if (!content) return '';
        
        // Используем marked для markdown
        if (typeof marked !== 'undefined') {
            marked.setOptions({
                highlight: function(code, lang) {
                    return `<pre><code class="language-${lang}">${escapeHtml(code)}</code><button class="copy-btn" onclick="copyToClipboard('${escapeHtml(code).replace(/'/g, "\\'")}')">📋 Копировать</button></pre>`;
                },
                breaks: true,
                gfm: true
            });
            return marked.parse(content);
        }
        
        // Fallback: простая обработка
        let formatted = content
            .replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang, code) => {
                return `<pre><code class="language-${lang}">${escapeHtml(code)}</code><button class="copy-btn" onclick="copyToClipboard('${escapeHtml(code).replace(/'/g, "\\'")}')">📋 Копировать</button></pre>`;
            })
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>')
            .replace(/\n/g, '<br>');
        
        return formatted;
    }
    
    // ============================================
    // ОТПРАВКА СООБЩЕНИЙ
    // ============================================
    
    async function sendMessage() {
        const message = messageInput.value.trim();
        if (!message || isTyping) return;
        
        // Очищаем поле ввода
        messageInput.value = '';
        messageInput.style.height = 'auto';
        
        // Скрываем welcome screen
        welcomeScreen.style.display = 'none';
        messagesList.style.display = 'block';
        
        // Добавляем сообщение пользователя
        addMessage('user', message);
        
        // Обновляем заголовок чата
        updateChatTitle(currentSessionId, message);
        
        // Показываем индикатор загрузки
        showTypingIndicator();
        isTyping = true;
        updateStatus('thinking', 'Думаю...');
        
        try {
            // Отправляем запрос с streaming
            await sendMessageWithStream(message);
            
        } catch (error) {
            console.error('Ошибка отправки:', error);
            
            // Показываем ошибку
            const errorMessage = 'Извините, произошла ошибка. Пожалуйста, попробуйте позже.';
            addMessage('bot', errorMessage);
            updateStatus('error', 'Ошибка');
            
        } finally {
            hideTypingIndicator();
            isTyping = false;
            updateStatus('ready', 'Готов к работе');
        }
    }
    
    async function sendMessageWithStream(message) {
        const selectedModel = modelSelect.value;
        
        // Прерываем предыдущий стрим если есть
        if (currentStreamController) {
            currentStreamController.abort();
        }
        
        currentStreamController = new AbortController();
        
        try {
            const response = await fetch(`/api/chat/${currentSessionId}/stream`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: message,
                    model: selectedModel,
                    temperature: 0.7
                }),
                signal: currentStreamController.signal
            });
            
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
                                    // Создаем новое сообщение бота
                                    const messageHtml = `
                                        <div class="message bot">
                                            <div class="message-avatar">
                                                <i class="fas fa-robot"></i>
                                            </div>
                                            <div class="message-content">
                                                <div class="message-bubble" id="streamingMessage">
                                                    ${formatMessageContent(fullResponse)}
                                                </div>
                                            </div>
                                        </div>
                                    `;
                                    messagesList.insertAdjacentHTML('beforeend', messageHtml);
                                    botMessageElement = document.getElementById('streamingMessage');
                                } else {
                                    // Обновляем существующее сообщение
                                    botMessageElement.innerHTML = formatMessageContent(fullResponse);
                                }
                                scrollToBottom();
                            }
                            
                            if (parsed.done) {
                                // Сохраняем полное сообщение
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
                            }
                            
                        } catch (e) {
                            // Пропускаем
                        }
                    }
                    
                    if (line.startsWith('event: done')) {
                        // Стрим завершен
                        break;
                    }
                    
                    if (line.startsWith('event: error')) {
                        const errorData = JSON.parse(line.slice(12));
                        throw new Error(errorData.error);
                    }
                }
            }
            
        } catch (error) {
            if (error.name !== 'AbortError') {
                throw error;
            }
        } finally {
            currentStreamController = null;
        }
    }
    
    async function sendFile(file) {
        if (!file) return;
        
        const formData = new FormData();
        formData.append('file', file);
        formData.append('language', file.name.split('.').pop());
        formData.append('sessionId', currentSessionId);
        
        welcomeScreen.style.display = 'none';
        messagesList.style.display = 'block';
        
        // Добавляем сообщение о загрузке файла
        addMessage('user', `📁 Загружен файл: ${file.name}\n\n\`\`\`${file.name.split('.').pop()}\n${await readFileContent(file)}\n\`\`\``);
        
        showTypingIndicator();
        isTyping = true;
        updateStatus('thinking', 'Анализирую код...');
        
        try {
            const response = await fetch('/api/analyze-code', {
                method: 'POST',
                body: formData
            });
            
            const data = await response.json();
            
            hideTypingIndicator();
            addMessage('bot', data.analysis);
            
        } catch (error) {
            console.error('Ошибка анализа:', error);
            addMessage('bot', 'Извините, не удалось проанализировать файл.');
        } finally {
            isTyping = false;
            updateStatus('ready', 'Готов к работе');
        }
    }
    
    function readFileContent(file) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const content = e.target.result;
                // Ограничиваем длину для отображения
                resolve(content.length > 2000 ? content.substring(0, 2000) + '\n... (файл обрезан)' : content);
            };
            reader.readAsText(file);
        });
    }
    
    // ============================================
    // ГОЛОСОВОЙ ВВОД
    // ============================================
    
    function initVoice() {
        if (typeof UniversalVoiceManager !== 'undefined') {
            voiceManager = new UniversalVoiceManager(getUserId());
            
            voiceManager.onTranscript = (text) => {
                messageInput.value = text;
                messageInput.dispatchEvent(new Event('input'));
            };
            
            voiceManager.onAIResponse = (answer) => {
                addMessage('bot', answer);
            };
            
            voiceManager.onError = (error) => {
                console.error('Voice error:', error);
                showToast(error, 'error');
            };
            
            voiceManager.onStatusChange = (status) => {
                if (status === 'recording') {
                    showVoiceModal();
                } else if (status === 'idle') {
                    hideVoiceModal();
                }
            };
            
            voiceManager.onVolumeChange = (volume) => {
                updateVoiceVisualizer(volume);
            };
        }
    }
    
    function getUserId() {
        let userId = localStorage.getItem('sokolov_user_id');
        if (!userId) {
            userId = 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            localStorage.setItem('sokolov_user_id', userId);
        }
        return userId;
    }
    
    let voiceModal = null;
    let voiceTimer = null;
    let voiceStartTime = null;
    
    function showVoiceModal() {
        if (!voiceModal) {
            voiceModal = document.getElementById('voiceModal');
        }
        if (voiceModal) {
            voiceModal.style.display = 'flex';
            voiceStartTime = Date.now();
            startVoiceTimer();
        }
    }
    
    function hideVoiceModal() {
        if (voiceModal) {
            voiceModal.style.display = 'none';
        }
        if (voiceTimer) {
            clearInterval(voiceTimer);
            voiceTimer = null;
        }
    }
    
    function startVoiceTimer() {
        const timerEl = document.getElementById('voiceTimer');
        voiceTimer = setInterval(() => {
            if (voiceStartTime) {
                const elapsed = Math.floor((Date.now() - voiceStartTime) / 1000);
                const minutes = Math.floor(elapsed / 60);
                const seconds = elapsed % 60;
                if (timerEl) {
                    timerEl.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
                }
            }
        }, 1000);
    }
    
    function updateVoiceVisualizer(volume) {
        const waves = document.querySelectorAll('.voice-waves span');
        const intensity = Math.min(5, Math.floor(volume / 20) + 1);
        waves.forEach((wave, i) => {
            const height = i < intensity ? 40 + volume : 20;
            wave.style.height = `${height}px`;
        });
    }
    
    // ============================================
    // UI ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
    // ============================================
    
    function showTypingIndicator() {
        if (typingIndicator) {
            typingIndicator.style.display = 'flex';
            scrollToBottom();
        }
    }
    
    function hideTypingIndicator() {
        if (typingIndicator) {
            typingIndicator.style.display = 'none';
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
    
    function showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `
            <i class="fas ${type === 'error' ? 'fa-exclamation-circle' : 'fa-info-circle'}"></i>
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
        `;
        
        document.body.appendChild(toast);
        
        setTimeout(() => {
            toast.style.animation = 'slideDown 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }
    
    function escapeHtml(text) {
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
    
    function adjustTextareaHeight() {
        if (messageInput) {
            messageInput.style.height = 'auto';
            messageInput.style.height = Math.min(messageInput.scrollHeight, 200) + 'px';
        }
    }
    
    // ============================================
    // ОБРАБОТЧИКИ СОБЫТИЙ
    // ============================================
    
    function setupEventListeners() {
        // Отправка сообщения
        sendBtn?.addEventListener('click', sendMessage);
        messageInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
        messageInput?.addEventListener('input', adjustTextareaHeight);
        
        // Новый чат
        newChatBtn?.addEventListener('click', async () => {
            await createNewSession();
        });
        
        // Очистить чат
        clearChatBtn?.addEventListener('click', () => {
            if (confirm('Очистить текущий чат?')) {
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
        
        // Меню на мобильных
        menuToggle?.addEventListener('click', () => {
            sidebar?.classList.toggle('open');
        });
        
        // Закрытие меню при клике вне
        document.addEventListener('click', (e) => {
            if (sidebar?.classList.contains('open')) {
                if (!sidebar.contains(e.target) && !menuToggle?.contains(e.target)) {
                    sidebar.classList.remove('open');
                }
            }
        });
        
        // Файлы
        attachFileBtn?.addEventListener('click', () => {
            fileInput?.click();
        });
        
        fileInput?.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                sendFile(e.target.files[0]);
                fileInput.value = '';
            }
        });
        
        // Голос
        recordVoiceBtn?.addEventListener('click', () => {
            if (voiceManager) {
                if (voiceManager.isRecordingActive()) {
                    voiceManager.stopRecording();
                } else {
                    voiceManager.startRecording();
                }
            } else {
                showToast('Голосовой ввод в разработке', 'info');
            }
        });
        
        // Очистка поля ввода
        clearInputBtn?.addEventListener('click', () => {
            messageInput.value = '';
            adjustTextareaHeight();
        });
        
        // Модальное окно голоса
        const voiceCancelBtn = document.getElementById('voiceCancelBtn');
        const voiceStopBtn = document.getElementById('voiceStopBtn');
        
        voiceCancelBtn?.addEventListener('click', () => {
            if (voiceManager) voiceManager.stopRecording();
            hideVoiceModal();
        });
        
        voiceStopBtn?.addEventListener('click', () => {
            if (voiceManager) voiceManager.stopRecording();
            hideVoiceModal();
        });
        
        // Предложения
        document.querySelectorAll('.suggestion-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const prompt = btn.dataset.prompt;
                if (prompt) {
                    messageInput.value = prompt;
                    sendMessage();
                }
            });
        });
        
        // Модель
        modelSelect?.addEventListener('change', () => {
            showToast(`Модель: ${modelSelect.options[modelSelect.selectedIndex].text}`, 'info');
        });
    }
    
    // ============================================
    // ЗАПУСК
    // ============================================
    
    // Копирование в буфер обмена
    window.copyToClipboard = function(text) {
        navigator.clipboard.writeText(text).then(() => {
            showToast('Скопировано в буфер обмена', 'success');
        }).catch(() => {
            showToast('Не удалось скопировать', 'error');
        });
    };
    
    // Запускаем приложение
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
    
})();
