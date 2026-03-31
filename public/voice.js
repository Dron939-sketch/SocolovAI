// ============================================
// СОКОЛОВ AI - ПОЛНОЦЕННЫЙ ГОЛОСОВОЙ МОДУЛЬ
// Работает на iOS, Android, Windows, Mac
// ============================================

(function() {
    'use strict';

    // ============================================
    // КОНФИГУРАЦИЯ
    // ============================================
    
    const VoiceConfig = {
        debug: true,
        recording: {
            maxDuration: 30000,      // 30 секунд
            minDuration: 500,        // 0.5 секунды
            sampleRate: 16000
        },
        ui: {
            autoStopAfterSilence: true,
            silenceTimeout: 2000,    // 2 секунды тишины
            minVolumeToConsiderSpeech: 5
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
    // КЛАСС АУДИО ПЛЕЕРА
    // ============================================
    
    class VoiceAudioPlayer {
        constructor() {
            this.audio = null;
            this.onPlayStart = null;
            this.onPlayEnd = null;
            this.onError = null;
            this.userGestureReceived = false;
            
            this.initUserGestureListener();
        }
        
        initUserGestureListener() {
            const handler = () => {
                this.userGestureReceived = true;
                document.removeEventListener('click', handler);
                document.removeEventListener('touchstart', handler);
                Logger.log('✅ Пользовательский жест получен, аудио готово');
            };
            document.addEventListener('click', handler);
            document.addEventListener('touchstart', handler);
        }
        
        async play(audioData) {
            return new Promise(async (resolve, reject) => {
                try {
                    if (!this.userGestureReceived) {
                        Logger.warn('Ожидание жеста пользователя...');
                        reject(new Error('WAITING_FOR_GESTURE'));
                        return;
                    }
                    
                    this.stop();
                    this.audio = new Audio();
                    
                    let audioUrl = audioData;
                    if (audioData instanceof Blob) {
                        audioUrl = URL.createObjectURL(audioData);
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
                        }).catch(reject);
                    }
                    
                    this.audio.onended = () => {
                        if (this.onPlayEnd) this.onPlayEnd();
                        resolve();
                    };
                    
                    this.audio.onerror = reject;
                    
                } catch (error) {
                    Logger.error('Play error:', error);
                    if (this.onError) this.onError(error);
                    reject(error);
                }
            });
        }
        
        stop() {
            if (this.audio) {
                this.audio.pause();
                this.audio.currentTime = 0;
                this.audio = null;
            }
        }
        
        dispose() {
            this.stop();
        }
    }

    // ============================================
    // КЛАСС ЗАПИСЧИКА
    // ============================================
    
    class VoiceRecorder {
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
            this.onSpeechDetected = null;
        }
        
        async start() {
            if (this.isRecording) {
                Logger.warn('Уже идет запись');
                return false;
            }
            
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
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
                    
                    const isSpeech = this.currentVolume > VoiceConfig.ui.minVolumeToConsiderSpeech;
                    
                    if (isSpeech) {
                        if (!this.speechDetected) {
                            this.speechDetected = true;
                            this.onSpeechDetected?.(true);
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
                        }, VoiceConfig.ui.silenceTimeout);
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
            this.recorder = null;
            this.player = null;
            this.isRecording = false;
            this.isPlaying = false;
            this.onTranscript = null;
            this.onResponse = null;
            this.onError = null;
            this.onRecordingStart = null;
            this.onRecordingStop = null;
            this.onVolumeChange = null;
            
            this.init();
        }
        
        init() {
            this.player = new VoiceAudioPlayer();
            this.recorder = new VoiceRecorder();
            
            this.player.onPlayStart = () => {
                this.isPlaying = true;
                Logger.log('🔊 Воспроизведение');
            };
            
            this.player.onPlayEnd = () => {
                this.isPlaying = false;
                Logger.log('🔇 Воспроизведение завершено');
            };
            
            this.recorder.onStart = () => {
                this.isRecording = true;
                this.onRecordingStart?.();
            };
            
            this.recorder.onStop = async (audioBlob) => {
                this.isRecording = false;
                this.onRecordingStop?.();
                
                if (audioBlob && audioBlob.size > 0) {
                    await this.processAudio(audioBlob);
                }
            };
            
            this.recorder.onVolumeChange = (volume) => {
                this.onVolumeChange?.(volume);
            };
            
            this.recorder.onError = (error) => {
                this.onError?.(error);
            };
            
            this.recorder.onSpeechDetected = (detected) => {
                if (detected) Logger.log('🎤 Речь обнаружена');
            };
            
            Logger.log('✅ Голосовой модуль инициализирован');
        }
        
        async processAudio(blob) {
            Logger.log(`📤 Отправка аудио (${(blob.size / 1024).toFixed(1)} KB)`);
            
            const formData = new FormData();
            formData.append('voice', blob, 'audio.wav');
            
            try {
                const response = await fetch('/api/voice/process', {
                    method: 'POST',
                    body: formData
                });
                
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
                this.onError?.('Ошибка соединения. Попробуйте позже.');
            }
        }
        
        startRecording() {
            if (this.isPlaying) {
                this.player.stop();
                setTimeout(() => this.recorder.start(), 300);
            } else {
                this.recorder.start();
            }
        }
        
        stopRecording() {
            this.recorder.stop();
        }
        
        isRecordingActive() {
            return this.isRecording;
        }
        
        isPlayingActive() {
            return this.isPlaying;
        }
        
        dispose() {
            this.recorder?.dispose();
            this.player?.dispose();
        }
    }

    // ============================================
    // ЭКСПОРТ
    // ============================================
    
    if (typeof window !== 'undefined') {
        window.VoiceManager = VoiceManager;
        window.VoiceRecorder = VoiceRecorder;
        window.VoiceAudioPlayer = VoiceAudioPlayer;
        Logger.log('🎤 Voice module loaded');
    }
})();
