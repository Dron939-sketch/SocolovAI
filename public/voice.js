// ============================================
// СОКОЛОВ AI - ГОЛОСОВОЙ МОДУЛЬ
// Универсальный, работает на iOS, Android, Windows
// ============================================

(function() {
    'use strict';
    
    // ============================================
    // КОНФИГУРАЦИЯ
    // ============================================
    
    const VoiceConfig = {
        apiBaseUrl: '',
        debug: true,
        
        recording: {
            maxDuration: 30000,
            minDuration: 500,
            sampleRate: 16000
        },
        
        ui: {
            autoStopAfterSilence: true,
            silenceTimeout: 3000,
            minVolumeToConsiderSpeech: 5
        }
    };
    
    // ============================================
    // АУДИО ПЛЕЕР (с поддержкой iOS)
    // ============================================
    
    class UniversalAudioPlayer {
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
                        this.pendingPlay = { url: audioData, mimeType };
                        reject(new Error('WAITING_FOR_GESTURE'));
                        return;
                    }
                    
                    this.stop();
                    
                    this.audio = new Audio();
                    let audioUrl = audioData;
                    
                    if (typeof audioData === 'string' && audioData.startsWith('data:audio/')) {
                        audioUrl = audioData;
                    } 
                    else if (typeof audioData === 'string' && audioData.startsWith('http')) {
                        audioUrl = audioData;
                    }
                    else if (audioData instanceof Blob) {
                        audioUrl = URL.createObjectURL(audioData);
                        this.currentUrl = audioUrl;
                    }
                    else {
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
    // ЗАПИСЧИК ГОЛОСА (MediaRecorder API)
    // ============================================
    
    class UniversalVoiceRecorder {
        constructor(config = {}) {
            this.config = { ...VoiceConfig.recording, ...config };
            this.isRecording = false;
            this.mediaStream = null;
            this.mediaRecorder = null;
            this.audioChunks = [];
            this.recordingTimeout = null;
            this.volumeInterval = null;
            this.audioContext = null;
            this.analyser = null;
            this.lastVolume = 0;
            this.speechDetected = false;
            this.silenceStartTime = null;
            
            this.onRecordingStart = null;
            this.onRecordingStop = null;
            this.onVolumeChange = null;
            this.onError = null;
            this.onSpeechDetected = null;
        }
        
        async startRecording() {
            if (this.isRecording) return false;
            
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                if (this.onError) this.onError('Ваш браузер не поддерживает запись');
                return false;
            }
            
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true
                    }
                });
                
                this.mediaStream = stream;
                this.audioChunks = [];
                this.isRecording = true;
                this.speechDetected = false;
                this.silenceStartTime = null;
                
                // Определяем поддерживаемый MIME тип
                let mimeType = '';
                if (MediaRecorder.isTypeSupported('audio/webm')) {
                    mimeType = 'audio/webm';
                } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
                    mimeType = 'audio/mp4';
                } else if (MediaRecorder.isTypeSupported('audio/mpeg')) {
                    mimeType = 'audio/mpeg';
                }
                
                this.mediaRecorder = new MediaRecorder(stream, {
                    mimeType: mimeType || undefined
                });
                
                this.mediaRecorder.ondataavailable = (event) => {
                    if (event.data && event.data.size > 0) {
                        this.audioChunks.push(event.data);
                    }
                };
                
                this.mediaRecorder.onstop = async () => {
                    if (this.audioChunks.length === 0) {
                        if (this.onRecordingStop) this.onRecordingStop(null);
                        return;
                    }
                    
                    let audioBlob = new Blob(this.audioChunks, { 
                        type: this.mediaRecorder.mimeType || 'audio/webm'
                    });
                    
                    // Конвертируем в WAV для лучшей совместимости
                    audioBlob = await this.convertToWav(audioBlob);
                    
                    if (this.onRecordingStop) {
                        this.onRecordingStop(audioBlob);
                    }
                };
                
                this.mediaRecorder.start(1000);
                
                this.recordingTimeout = setTimeout(() => {
                    if (this.isRecording) this.stopRecording();
                }, this.config.maxDuration);
                
                this.startVolumeAnalysis(stream);
                
                if (this.onRecordingStart) this.onRecordingStart();
                
                return true;
                
            } catch (error) {
                console.error('Recording error:', error);
                let errorMessage = 'Ошибка доступа к микрофону';
                if (error.name === 'NotAllowedError') {
                    errorMessage = 'Разрешите доступ к микрофону в настройках';
                }
                if (this.onError) this.onError(errorMessage);
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
                    let volume = Math.min(100, (sum / dataArray.length / 255) * 100);
                    
                    this.lastVolume = volume;
                    if (this.onVolumeChange) this.onVolumeChange(volume);
                    
                    const isSpeech = volume > VoiceConfig.ui.minVolumeToConsiderSpeech;
                    
                    if (isSpeech) {
                        if (!this.speechDetected) {
                            this.speechDetected = true;
                            if (this.onSpeechDetected) this.onSpeechDetected(true);
                        }
                        this.silenceStartTime = null;
                    } else if (this.speechDetected && this.silenceStartTime === null) {
                        this.silenceStartTime = Date.now();
                    }
                    
                    if (VoiceConfig.ui.autoStopAfterSilence && 
                        this.speechDetected && 
                        this.silenceStartTime && 
                        (Date.now() - this.silenceStartTime) > VoiceConfig.ui.silenceTimeout) {
                        this.stopRecording();
                    }
                    
                }, 100);
                
                if (this.audioContext.state === 'suspended') {
                    this.audioContext.resume();
                }
                
            } catch (error) {
                console.warn('Volume analysis unavailable:', error);
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
                console.warn('WAV conversion failed:', error);
                return blob;
            }
        }
        
        audioBufferToWav(buffer) {
            const numChannels = buffer.numberOfChannels;
            const sampleRate = buffer.sampleRate;
            const format = 1;
            const bitDepth = 16;
            
            const samples = buffer.getChannelData(0);
            const dataLength = samples.length * (bitDepth / 8);
            const bufferLength = 44 + dataLength;
            
            const arrayBuffer = new ArrayBuffer(bufferLength);
            const view = new DataView(arrayBuffer);
            
            this.writeString(view, 0, 'RIFF');
            view.setUint32(4, bufferLength - 8, true);
            this.writeString(view, 8, 'WAVE');
            this.writeString(view, 12, 'fmt ');
            view.setUint32(16, 16, true);
            view.setUint16(20, format, true);
            view.setUint16(22, numChannels, true);
            view.setUint32(24, sampleRate, true);
            view.setUint32(28, sampleRate * numChannels * (bitDepth / 8), true);
            view.setUint16(32, numChannels * (bitDepth / 8), true);
            view.setUint16(34, bitDepth, true);
            this.writeString(view, 36, 'data');
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
        
        writeString(view, offset, string) {
            for (let i = 0; i < string.length; i++) {
                view.setUint8(offset + i, string.charCodeAt(i));
            }
        }
        
        stopRecording() {
            if (!this.isRecording) return null;
            
            this.isRecording = false;
            
            if (this.recordingTimeout) clearTimeout(this.recordingTimeout);
            if (this.volumeInterval) clearInterval(this.volumeInterval);
            
            if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
                this.mediaRecorder.stop();
            }
            
            if (this.audioContext) this.audioContext.close();
            if (this.mediaStream) {
                this.mediaStream.getTracks().forEach(track => track.stop());
            }
            
            return true;
        }
        
        isRecordingActive() {
            return this.isRecording;
        }
        
        dispose() {
            this.stopRecording();
        }
    }
    
    // ============================================
    // ГОЛОСОВОЙ МЕНЕДЖЕР
    // ============================================
    
    class UniversalVoiceManager {
        constructor(userId, config = {}) {
            this.userId = userId;
            this.config = { ...VoiceConfig, ...config };
            this.recorder = null;
            this.player = null;
            this.isRecording = false;
            this.isAISpeaking = false;
            this.currentMode = 'default';
            this.apiBaseUrl = '';
            
            this.onTranscript = null;
            this.onAIResponse = null;
            this.onStatusChange = null;
            this.onError = null;
            this.onRecordingStart = null;
            this.onRecordingStop = null;
            this.onVolumeChange = null;
            this.onThinking = null;
            this.onSpeechDetected = null;
            
            this.init();
        }
        
        init() {
            this.player = new UniversalAudioPlayer();
            this.recorder = new UniversalVoiceRecorder();
            
            this.player.onPlayStart = () => {
                this.isAISpeaking = true;
                this.updateStatus('speaking');
            };
            
            this.player.onPlayEnd = () => {
                this.isAISpeaking = false;
                this.updateStatus('idle');
            };
            
            this.player.onError = (error) => {
                if (this.onError) this.onError('Ошибка воспроизведения');
            };
            
            this.recorder.onRecordingStart = () => {
                this.isRecording = true;
                if (this.onRecordingStart) this.onRecordingStart();
                this.updateStatus('recording');
            };
            
            this.recorder.onRecordingStop = async (audioBlob) => {
                this.isRecording = false;
                if (this.onRecordingStop) this.onRecordingStop(audioBlob);
                
                if (audioBlob && audioBlob.size > 0) {
                    await this.sendAudio(audioBlob);
                }
                this.updateStatus('idle');
            };
            
            this.recorder.onVolumeChange = (volume) => {
                if (this.onVolumeChange) this.onVolumeChange(volume);
            };
            
            this.recorder.onError = (error) => {
                if (this.onError) this.onError(error);
            };
            
            this.recorder.onSpeechDetected = (detected) => {
                if (this.onSpeechDetected) this.onSpeechDetected(detected);
            };
        }
        
        async sendAudio(audioBlob) {
            if (this.onThinking) this.onThinking(true);
            
            try {
                const formData = new FormData();
                formData.append('voice', audioBlob, 'audio.wav');
                formData.append('user_id', this.userId);
                formData.append('mode', this.currentMode);
                
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 30000);
                
                const response = await fetch('/api/voice/process', {
                    method: 'POST',
                    body: formData,
                    signal: controller.signal
                });
                
                clearTimeout(timeoutId);
                
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                
                const result = await response.json();
                
                if (this.onThinking) this.onThinking(false);
                
                if (result.success) {
                    if (this.onTranscript && result.recognized_text) {
                        this.onTranscript(result.recognized_text);
                    }
                    if (this.onAIResponse && result.answer) {
                        this.onAIResponse(result.answer);
                    }
                    return true;
                } else {
                    throw new Error(result.error || 'Ошибка');
                }
                
            } catch (error) {
                if (this.onThinking) this.onThinking(false);
                if (this.onError) this.onError('Ошибка соединения');
                return false;
            }
        }
        
        startRecording() {
            if (this.isAISpeaking) {
                this.interrupt();
                setTimeout(() => this.recorder.startRecording(), 300);
            } else {
                this.recorder.startRecording();
            }
        }
        
        stopRecording() {
            return this.recorder.stopRecording();
        }
        
        interrupt() {
            if (this.player) this.player.stop();
            this.isAISpeaking = false;
        }
        
        updateStatus(status) {
            if (this.onStatusChange) this.onStatusChange(status);
        }
        
        setMode(mode) {
            this.currentMode = mode;
        }
        
        isRecordingActive() {
            return this.recorder?.isRecordingActive() || false;
        }
        
        isSpeaking() {
            return this.isAISpeaking;
        }
        
        getCurrentMode() {
            return this.currentMode;
        }
        
        dispose() {
            if (this.recorder) this.recorder.dispose();
            if (this.player) this.player.dispose();
        }
    }
    
    // ============================================
    // ЭКСПОРТ
    // ============================================
    
    if (typeof window !== 'undefined') {
        window.UniversalAudioPlayer = UniversalAudioPlayer;
        window.UniversalVoiceRecorder = UniversalVoiceRecorder;
        window.UniversalVoiceManager = UniversalVoiceManager;
        window.VoiceConfig = VoiceConfig;
        
        console.log('🎤 Voice module loaded');
    }
    
})();
