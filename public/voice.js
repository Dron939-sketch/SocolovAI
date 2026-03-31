// ============================================
// СОКОЛОВ AI - ПОЛНОЦЕННЫЙ ГОЛОСОВОЙ МОДУЛЬ
// Поддержка: SpeechRecognition API, MediaRecorder, iOS, Android, Windows
// ============================================

(function() {
    'use strict';

    // ============================================
    // КОНФИГУРАЦИЯ
    // ============================================
    
    const VoiceConfig = {
        debug: true,
        
        // Настройки распознавания речи
        recognition: {
            lang: 'ru-RU',
            interimResults: true,
            continuous: false,
            maxAlternatives: 1
        },
        
        // Настройки записи (для браузеров без SpeechRecognition)
        recording: {
            maxDuration: 30000,
            minDuration: 500,
            sampleRate: 16000,
            silenceTimeout: 2000,
            minVolumeToConsiderSpeech: 5
        },
        
        // Визуализация
        visualizer: {
            enabled: true,
            barsCount: 20,
            updateInterval: 50
        }
    };

    // ============================================
    // ЛОГГЕР
    // ============================================
    
    const Logger = {
        log: (...args) => {
            if (VoiceConfig.debug) console.log('🎤 [Voice]', ...args);
        },
        error: (...args) => {
            console.error('🎤 [Voice Error]', ...args);
        },
        warn: (...args) => {
            if (VoiceConfig.debug) console.warn('🎤 [Voice Warn]', ...args);
        }
    };

    // ============================================
    // ПРОВЕРКА ПОДДЕРЖКИ
    // ============================================
    
    function isSpeechRecognitionSupported() {
        return 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
    }
    
    function isMediaRecorderSupported() {
        return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    }
    
    // ============================================
    // АУДИО ПЛЕЕР (с поддержкой iOS)
    // ============================================
    
    class VoiceAudioPlayer {
        constructor() {
            this.audio = null;
            this.currentUrl = null;
            this.onPlayStart = null;
            this.onPlayEnd = null;
            this.onError = null;
            this.userGestureReceived = false;
            this.pendingPlay = null;
            
            this.initUserGestureListener();
        }
        
        initUserGestureListener() {
            const handler = () => {
                this.userGestureReceived = true;
                document.removeEventListener('click', handler);
                document.removeEventListener('touchstart', handler);
                document.removeEventListener('touchend', handler);
                Logger.log('✅ Пользовательский жест получен, аудио готово');
                
                if (this.pendingPlay) {
                    this.play(this.pendingPlay.url, this.pendingPlay.mimeType);
                    this.pendingPlay = null;
                }
            };
            
            document.addEventListener('click', handler);
            document.addEventListener('touchstart', handler);
            document.addEventListener('touchend', handler);
        }
        
        async play(audioData, mimeType = 'audio/mpeg') {
            return new Promise(async (resolve, reject) => {
                try {
                    if (!this.userGestureReceived) {
                        Logger.warn('Ожидание жеста пользователя...');
                        this.pendingPlay = { url: audioData, mimeType };
                        reject(new Error('WAITING_FOR_GESTURE'));
                        return;
                    }
                    
                    this.stop();
                    this.audio = new Audio();
                    
                    let audioUrl = audioData;
                    if (audioData instanceof Blob) {
                        audioUrl = URL.createObjectURL(audioData);
                        this.currentUrl = audioUrl;
                    } else if (typeof audioData === 'string' && !audioData.startsWith('http') && !audioData.startsWith('data:')) {
                        audioUrl = `data:audio/mpeg;base64,${audioData}`;
                    }
                    
                    this.audio.src = audioUrl;
                    this.audio.load();
                    
                    const playPromise = this.audio.play();
                    if (playPromise !== undefined) {
                        playPromise.then(() => {
                            if (this.onPlayStart) this.onPlayStart();
                            resolve();
                        }).catch(error => {
                            if (error.name === 'NotAllowedError') {
                                this.userGestureReceived = false;
                                this.pendingPlay = { url: audioData, mimeType };
                            }
                            if (this.onError) this.onError(error);
                            reject(error);
                        });
                    }
                    
                    this.audio.onended = () => {
                        this.cleanupBlobUrl();
                        if (this.onPlayEnd) this.onPlayEnd();
                        resolve();
                    };
                    
                    this.audio.onerror = (error) => {
                        this.cleanupBlobUrl();
                        if (this.onError) this.onError(error);
                        reject(error);
                    };
                    
                } catch (error) {
                    Logger.error('Play error:', error);
                    reject(error);
                }
            });
        }
        
        cleanupBlobUrl() {
            if (this.currentUrl && this.currentUrl.startsWith('blob:')) {
                URL.revokeObjectURL(this.currentUrl);
                this.currentUrl = null;
            }
        }
        
        stop() {
            if (this.audio) {
                this.audio.pause();
                this.audio.currentTime = 0;
                this.audio = null;
            }
            this.cleanupBlobUrl();
        }
        
        isPlaying() {
            return this.audio && !this.audio.paused && !this.audio.ended;
        }
        
        dispose() {
            this.stop();
        }
    }

    // ============================================
    // SPEECH RECOGNITION (СОВРЕМЕННЫЙ МЕТОД)
    // ============================================
    
    class SpeechRecognitionService {
        constructor() {
            this.recognition = null;
            this.isListening = false;
            this.onResult = null;
            this.onError = null;
            this.onStart = null;
            this.onEnd = null;
            this.interimText = '';
            this.finalText = '';
            
            this.init();
        }
        
        init() {
            if (!isSpeechRecognitionSupported()) {
                Logger.warn('SpeechRecognition не поддерживается');
                return false;
            }
            
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            this.recognition = new SpeechRecognition();
            
            this.recognition.lang = VoiceConfig.recognition.lang;
            this.recognition.interimResults = VoiceConfig.recognition.interimResults;
            this.recognition.continuous = VoiceConfig.recognition.continuous;
            this.recognition.maxAlternatives = VoiceConfig.recognition.maxAlternatives;
            
            this.recognition.onstart = () => {
                this.isListening = true;
                this.interimText = '';
                this.finalText = '';
                Logger.log('🎙️ Распознавание речи начато');
                if (this.onStart) this.onStart();
            };
            
            this.recognition.onend = () => {
                this.isListening = false;
                Logger.log('🔇 Распознавание речи завершено');
                if (this.onEnd) this.onEnd(this.finalText || this.interimText);
            };
            
            this.recognition.onresult = (event) => {
                let interim = '';
                let final = '';
                
                for (let i = event.resultIndex; i < event.results.length; i++) {
                    const transcript = event.results[i][0].transcript;
                    if (event.results[i].isFinal) {
                        final += transcript;
                    } else {
                        interim += transcript;
                    }
                }
                
                this.interimText = interim;
                if (final) this.finalText = final;
                
                const text = final || interim;
                if (this.onResult) {
                    this.onResult(text, !!final);
                }
            };
            
            this.recognition.onerror = (event) => {
                Logger.error('Ошибка распознавания:', event.error);
                this.isListening = false;
                if (this.onError) {
                    let message = 'Ошибка распознавания речи';
                    switch (event.error) {
                        case 'not-allowed':
                            message = 'Доступ к микрофону запрещен. Разрешите доступ в настройках.';
                            break;
                        case 'no-speech':
                            message = 'Речь не обнаружена. Попробуйте еще раз.';
                            break;
                        case 'audio-capture':
                            message = 'Микрофон не найден. Проверьте подключение.';
                            break;
                        case 'network':
                            message = 'Ошибка сети. Проверьте подключение к интернету.';
                            break;
                    }
                    this.onError(message);
                }
            };
            
            Logger.log('✅ SpeechRecognition инициализирован');
            return true;
        }
        
        start() {
            if (!this.recognition) {
                Logger.error('SpeechRecognition не инициализирован');
                return false;
            }
            
            try {
                this.recognition.start();
                return true;
            } catch (error) {
                Logger.error('Ошибка запуска:', error);
                return false;
            }
        }
        
        stop() {
            if (!this.recognition || !this.isListening) return;
            
            try {
                this.recognition.stop();
            } catch (error) {
                Logger.error('Ошибка остановки:', error);
            }
        }
        
        isSupported() {
            return !!this.recognition;
        }
    }

    // ============================================
    // MEDIA RECORDER (ФОЛБЭК ДЛЯ СТАРЫХ БРАУЗЕРОВ)
    // ============================================
    
    class MediaRecorderService {
        constructor() {
            this.isRecording = false;
            this.mediaStream = null;
            this.mediaRecorder = null;
            this.audioChunks = [];
            this.recordingTimeout = null;
            this.silenceTimeout = null;
            this.audioContext = null;
            this.analyser = null;
            this.volumeInterval = null;
            this.currentVolume = 0;
            this.speechDetected = false;
            this.silenceStartTime = null;
            
            this.onStart = null;
            this.onStop = null;
            this.onVolumeChange = null;
            this.onError = null;
            this.onTranscript = null;
        }
        
        async start() {
            if (this.isRecording) return false;
            
            if (!isMediaRecorderSupported()) {
                this.onError?.('Ваш браузер не поддерживает запись голоса');
                return false;
            }
            
            try {
                Logger.log('Запрос доступа к микрофону...');
                
                const stream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true,
                        sampleRate: VoiceConfig.recording.sampleRate
                    }
                });
                
                this.mediaStream = stream;
                this.audioChunks = [];
                this.isRecording = true;
                this.speechDetected = false;
                this.silenceStartTime = null;
                
                // Определяем поддерживаемый MIME тип
                let mimeType = '';
                const supportedTypes = ['audio/webm', 'audio/mp4', 'audio/mpeg'];
                for (const type of supportedTypes) {
                    if (MediaRecorder.isTypeSupported(type)) {
                        mimeType = type;
                        break;
                    }
                }
                
                this.mediaRecorder = new MediaRecorder(stream, { mimeType: mimeType || undefined });
                
                this.mediaRecorder.ondataavailable = (event) => {
                    if (event.data && event.data.size > 0) {
                        this.audioChunks.push(event.data);
                    }
                };
                
                this.mediaRecorder.onstop = async () => {
                    if (this.audioChunks.length === 0) {
                        this.onStop?.(null);
                        return;
                    }
                    
                    const blob = new Blob(this.audioChunks, { type: this.mediaRecorder.mimeType || 'audio/webm' });
                    const wavBlob = await this.convertToWav(blob);
                    this.onStop?.(wavBlob);
                };
                
                this.mediaRecorder.start(1000);
                
                this.recordingTimeout = setTimeout(() => {
                    if (this.isRecording) {
                        Logger.log('Достигнута максимальная длительность записи');
                        this.stop();
                    }
                }, VoiceConfig.recording.maxDuration);
                
                this.startVolumeAnalysis(stream);
                
                this.onStart?.();
                Logger.log('🎙️ Запись начата');
                return true;
                
            } catch (error) {
                Logger.error('Ошибка доступа к микрофону:', error);
                let message = 'Не удалось получить доступ к микрофону';
                if (error.name === 'NotAllowedError') {
                    message = 'Пожалуйста, разрешите доступ к микрофону в настройках браузера';
                } else if (error.name === 'NotFoundError') {
                    message = 'Микрофон не найден. Проверьте подключение';
                }
                this.onError?.(message);
                return false;
            }
        }
        
        startVolumeAnalysis(stream) {
            try {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                const source = this.audioContext.createMediaStreamSource(stream);
                this.analyser = this.audioContext.createAnalyser();
                this.analyser.fftSize = 256;
                source.connect(this.analyser);
                
                this.volumeInterval = setInterval(() => {
                    if (!this.isRecording) return;
                    
                    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
                    this.analyser.getByteFrequencyData(dataArray);
                    
                    let sum = 0;
                    for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
                    this.currentVolume = Math.min(100, (sum / dataArray.length / 255) * 100);
                    
                    this.onVolumeChange?.(this.currentVolume);
                    
                    const isSpeech = this.currentVolume > VoiceConfig.recording.minVolumeToConsiderSpeech;
                    
                    if (isSpeech) {
                        if (!this.speechDetected) {
                            this.speechDetected = true;
                            Logger.log('🗣️ Речь обнаружена');
                        }
                        this.silenceStartTime = null;
                        if (this.silenceTimeout) {
                            clearTimeout(this.silenceTimeout);
                            this.silenceTimeout = null;
                        }
                    } else if (this.speechDetected && !this.silenceStartTime) {
                        this.silenceStartTime = Date.now();
                        this.silenceTimeout = setTimeout(() => {
                            if (this.isRecording && this.speechDetected) {
                                Logger.log('🔇 Обнаружена тишина, запись остановлена');
                                this.stop();
                            }
                        }, VoiceConfig.recording.silenceTimeout);
                    }
                    
                }, 100);
                
                if (this.audioContext.state === 'suspended') {
                    this.audioContext.resume();
                }
                
            } catch (error) {
                Logger.warn('Анализ громкости недоступен:', error);
            }
        }
        
        async convertToWav(blob) {
            try {
                const arrayBuffer = await blob.arrayBuffer();
                const audioContext = new (window.AudioContext || window.webkitAudioContext)();
                const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
                
                const wavBuffer = this.audioBufferToWav(audioBuffer);
                await audioContext.close();
                
                return new Blob([wavBuffer], { type: 'audio/wav' });
            } catch (error) {
                Logger.warn('Конвертация в WAV не удалась:', error);
                return blob;
            }
        }
        
        audioBufferToWav(buffer) {
            const numChannels = buffer.numberOfChannels;
            const sampleRate = buffer.sampleRate;
            const samples = buffer.getChannelData(0);
            const dataLength = samples.length * 2;
            const bufferLength = 44 + dataLength;
            
            const arrayBuffer = new ArrayBuffer(bufferLength);
            const view = new DataView(arrayBuffer);
            
            const writeString = (offset, str) => {
                for (let i = 0; i < str.length; i++) {
                    view.setUint8(offset + i, str.charCodeAt(i));
                }
            };
            
            writeString(0, 'RIFF');
            view.setUint32(4, bufferLength - 8, true);
            writeString(8, 'WAVE');
            writeString(12, 'fmt ');
            view.setUint32(16, 16, true);
            view.setUint16(20, 1, true);
            view.setUint16(22, numChannels, true);
            view.setUint32(24, sampleRate, true);
            view.setUint32(28, sampleRate * numChannels * 2, true);
            view.setUint16(32, numChannels * 2, true);
            view.setUint16(34, 16, true);
            writeString(36, 'data');
            view.setUint32(40, dataLength, true);
            
            let offset = 44;
            for (let i = 0; i < samples.length; i++) {
                const sample = Math.max(-1, Math.min(1, samples[i]));
                const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
                view.setInt16(offset, int16, true);
                offset += 2;
            }
            
            return arrayBuffer;
        }
        
        stop() {
            if (!this.isRecording) return null;
            
            this.isRecording = false;
            
            if (this.recordingTimeout) clearTimeout(this.recordingTimeout);
            if (this.silenceTimeout) clearTimeout(this.silenceTimeout);
            if (this.volumeInterval) clearInterval(this.volumeInterval);
            
            if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
                this.mediaRecorder.stop();
            }
            
            if (this.audioContext) this.audioContext.close();
            if (this.mediaStream) {
                this.mediaStream.getTracks().forEach(track => track.stop());
            }
            
            Logger.log('⏹️ Запись остановлена');
            return true;
        }
        
        isActive() {
            return this.isRecording;
        }
        
        getVolume() {
            return this.currentVolume;
        }
        
        dispose() {
            this.stop();
        }
    }

    // ============================================
    // ОСНОВНОЙ МЕНЕДЖЕР ГОЛОСА
    // ============================================
    
    class VoiceManager {
        constructor() {
            this.speechRecognition = null;
            this.mediaRecorder = null;
            this.player = null;
            this.useSpeechRecognition = isSpeechRecognitionSupported();
            this.isRecording = false;
            this.isPlaying = false;
            this.currentMode = 'speech'; // 'speech' or 'recording'
            this.interimText = '';
            
            // Callbacks
            this.onTranscript = null;
            this.onInterimTranscript = null;
            this.onResponse = null;
            this.onError = null;
            this.onRecordingStart = null;
            this.onRecordingStop = null;
            this.onVolumeChange = null;
            this.onStatusChange = null;
            
            this.init();
        }
        
        init() {
            this.player = new VoiceAudioPlayer();
            
            this.player.onPlayStart = () => {
                this.isPlaying = true;
                this.updateStatus('playing');
                Logger.log('🔊 Воспроизведение');
            };
            
            this.player.onPlayEnd = () => {
                this.isPlaying = false;
                this.updateStatus('idle');
                Logger.log('🔇 Воспроизведение завершено');
            };
            
            this.player.onError = (error) => {
                Logger.error('Ошибка воспроизведения:', error);
                this.onError?.('Ошибка воспроизведения аудио');
            };
            
            // Выбираем метод распознавания
            if (this.useSpeechRecognition) {
                Logger.log('📱 Используется SpeechRecognition API');
                this.initSpeechRecognition();
            } else if (isMediaRecorderSupported()) {
                Logger.log('🎙️ Используется MediaRecorder (фолбэк)');
                this.initMediaRecorder();
            } else {
                Logger.error('❌ Голосовой ввод не поддерживается в этом браузере');
                this.onError?.('Ваш браузер не поддерживает голосовой ввод');
            }
        }
        
        initSpeechRecognition() {
            this.speechRecognition = new SpeechRecognitionService();
            
            this.speechRecognition.onStart = () => {
                this.isRecording = true;
                this.interimText = '';
                this.updateStatus('recording');
                this.onRecordingStart?.();
                Logger.log('🎤 Распознавание начато');
            };
            
            this.speechRecognition.onEnd = (finalText) => {
                this.isRecording = false;
                this.updateStatus('processing');
                this.onRecordingStop?.();
                
                if (finalText && finalText.trim()) {
                    Logger.log(`📝 Распознано: "${finalText}"`);
                    this.onTranscript?.(finalText);
                } else if (this.interimText) {
                    Logger.log(`📝 Промежуточный результат: "${this.interimText}"`);
                    this.onTranscript?.(this.interimText);
                } else {
                    this.onError?.('Речь не распознана. Попробуйте еще раз.');
                }
                
                this.updateStatus('idle');
            };
            
            this.speechRecognition.onResult = (text, isFinal) => {
                this.interimText = text;
                if (this.onInterimTranscript) {
                    this.onInterimTranscript(text, isFinal);
                }
            };
            
            this.speechRecognition.onError = (error) => {
                this.isRecording = false;
                this.updateStatus('idle');
                this.onError?.(error);
            };
        }
        
        initMediaRecorder() {
            this.mediaRecorder = new MediaRecorderService();
            
            this.mediaRecorder.onStart = () => {
                this.isRecording = true;
                this.updateStatus('recording');
                this.onRecordingStart?.();
                Logger.log('🎤 Запись начата');
            };
            
            this.mediaRecorder.onStop = async (audioBlob) => {
                this.isRecording = false;
                this.updateStatus('processing');
                this.onRecordingStop?.();
                
                if (audioBlob && audioBlob.size > 0) {
                    await this.processAudio(audioBlob);
                } else {
                    this.onError?.('Не удалось записать голос');
                }
                
                this.updateStatus('idle');
            };
            
            this.mediaRecorder.onVolumeChange = (volume) => {
                this.onVolumeChange?.(volume);
            };
            
            this.mediaRecorder.onError = (error) => {
                this.isRecording = false;
                this.updateStatus('idle');
                this.onError?.(error);
            };
            
            this.mediaRecorder.onTranscript = (text) => {
                this.onTranscript?.(text);
            };
        }
        
        async processAudio(blob) {
            Logger.log(`📤 Отправка аудио (${(blob.size / 1024).toFixed(1)} KB)`);
            
            const formData = new FormData();
            formData.append('voice', blob, 'audio.wav');
            
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 30000);
                
                const response = await fetch('/api/voice/process', {
                    method: 'POST',
                    body: formData,
                    signal: controller.signal
                });
                
                clearTimeout(timeoutId);
                
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                
                const data = await response.json();
                
                if (data.success) {
                    if (data.recognized_text && this.onTranscript) {
                        this.onTranscript(data.recognized_text);
                    }
                    if (data.answer && this.onResponse) {
                        this.onResponse(data.answer);
                    }
                } else {
                    throw new Error(data.error || 'Ошибка обработки');
                }
                
            } catch (error) {
                Logger.error('Ошибка отправки:', error);
                let message = 'Ошибка соединения. Попробуйте позже.';
                if (error.name === 'AbortError') {
                    message = 'Превышено время ожидания ответа от сервера.';
                }
                this.onError?.(message);
            }
        }
        
        startRecording() {
            if (this.isPlaying) {
                this.player.stop();
                setTimeout(() => this.startRecordingInternal(), 300);
            } else {
                this.startRecordingInternal();
            }
        }
        
        startRecordingInternal() {
            if (this.useSpeechRecognition && this.speechRecognition) {
                this.speechRecognition.start();
            } else if (this.mediaRecorder) {
                this.mediaRecorder.start();
            } else {
                this.onError?.('Голосовой ввод недоступен');
            }
        }
        
        stopRecording() {
            if (this.useSpeechRecognition && this.speechRecognition && this.speechRecognition.isListening) {
                this.speechRecognition.stop();
            } else if (this.mediaRecorder && this.mediaRecorder.isActive()) {
                this.mediaRecorder.stop();
            }
        }
        
        playAudio(audioData) {
            return this.player.play(audioData);
        }
        
        stopAudio() {
            this.player.stop();
        }
        
        updateStatus(status) {
            if (this.onStatusChange) {
                this.onStatusChange(status);
            }
        }
        
        isRecordingActive() {
            if (this.useSpeechRecognition && this.speechRecognition) {
                return this.speechRecognition.isListening;
            }
            return this.mediaRecorder?.isActive() || false;
        }
        
        isPlayingActive() {
            return this.isPlaying;
        }
        
        getVolume() {
            return this.mediaRecorder?.getVolume() || 0;
        }
        
        getInterimText() {
            return this.interimText;
        }
        
        isSupported() {
            return this.useSpeechRecognition || isMediaRecorderSupported();
        }
        
        dispose() {
            this.stopRecording();
            this.stopAudio();
            if (this.mediaRecorder) this.mediaRecorder.dispose();
            if (this.player) this.player.dispose();
        }
    }

    // ============================================
    // ЭКСПОРТ
    // ============================================
    
    if (typeof window !== 'undefined') {
        window.VoiceManager = VoiceManager;
        window.SpeechRecognitionService = SpeechRecognitionService;
        window.MediaRecorderService = MediaRecorderService;
        window.VoiceAudioPlayer = VoiceAudioPlayer;
        window.isSpeechRecognitionSupported = isSpeechRecognitionSupported;
        window.isMediaRecorderSupported = isMediaRecorderSupported;
        
        Logger.log('🎤 Voice module loaded');
        Logger.log(`📱 SpeechRecognition: ${isSpeechRecognitionSupported() ? 'доступно' : 'недоступно'}`);
        Logger.log(`🎙️ MediaRecorder: ${isMediaRecorderSupported() ? 'доступно' : 'недоступно'}`);
    }
    
})();
