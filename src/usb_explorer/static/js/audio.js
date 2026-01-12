/**
 * Audio notification handler with user gesture requirement handling.
 * Supports per-event-type sound settings.
 */

class AudioManager {
    constructor() {
        // Load settings from localStorage or use defaults
        this.settings = this.loadSettings();

        this.initialized = false;
        this.connectSound = document.getElementById('sound-connect');
        this.disconnectSound = document.getElementById('sound-disconnect');

        // Audio context for generating fallback sounds
        this.audioContext = null;

        // Initialize on first user interaction
        this.initOnInteraction();
    }

    loadSettings() {
        const defaults = {
            enabled: true,
            connect: true,
            disconnect: true,
            error: true
        };

        try {
            const saved = localStorage.getItem('usbdebug_sound_settings');
            if (saved) {
                return { ...defaults, ...JSON.parse(saved) };
            }
        } catch (e) {
            console.warn('Could not load sound settings:', e);
        }
        return defaults;
    }

    saveSettings() {
        try {
            localStorage.setItem('usbdebug_sound_settings', JSON.stringify(this.settings));
        } catch (e) {
            console.warn('Could not save sound settings:', e);
        }
    }

    initOnInteraction() {
        const initAudio = () => {
            if (this.initialized) return;

            // Create audio context
            try {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                this.initialized = true;
                console.log('Audio initialized');
            } catch (e) {
                console.warn('Could not create AudioContext:', e);
            }

            // Remove listeners
            document.removeEventListener('click', initAudio);
            document.removeEventListener('keydown', initAudio);
        };

        document.addEventListener('click', initAudio, { once: true });
        document.addEventListener('keydown', initAudio, { once: true });
    }

    async playConnect() {
        if (!this.settings.enabled || !this.settings.connect) return;

        try {
            if (this.connectSound && this.connectSound.src) {
                this.connectSound.currentTime = 0;
                await this.connectSound.play();
            } else {
                this.playTone(880, 0.1, 'sine'); // High beep
            }
        } catch (e) {
            // Fallback to generated tone
            this.playTone(880, 0.1, 'sine');
        }
    }

    async playDisconnect() {
        if (!this.settings.enabled || !this.settings.disconnect) return;

        try {
            if (this.disconnectSound && this.disconnectSound.src) {
                this.disconnectSound.currentTime = 0;
                await this.disconnectSound.play();
            } else {
                this.playTone(440, 0.15, 'sine'); // Low beep
            }
        } catch (e) {
            // Fallback to generated tone
            this.playTone(440, 0.15, 'sine');
        }
    }

    playError() {
        if (!this.settings.enabled || !this.settings.error) return;
        // Two quick low beeps
        this.playTone(330, 0.08, 'square');
        setTimeout(() => this.playTone(330, 0.08, 'square'), 120);
    }

    playTone(frequency, duration, type = 'sine') {
        if (!this.audioContext || !this.initialized) return;

        try {
            const oscillator = this.audioContext.createOscillator();
            const gainNode = this.audioContext.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(this.audioContext.destination);

            oscillator.type = type;
            oscillator.frequency.setValueAtTime(frequency, this.audioContext.currentTime);

            // Fade out
            gainNode.gain.setValueAtTime(0.3, this.audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + duration);

            oscillator.start(this.audioContext.currentTime);
            oscillator.stop(this.audioContext.currentTime + duration);
        } catch (e) {
            console.warn('Could not play tone:', e);
        }
    }

    toggle() {
        this.settings.enabled = !this.settings.enabled;
        this.saveSettings();
        return this.settings.enabled;
    }

    setEnabled(enabled) {
        this.settings.enabled = enabled;
        this.saveSettings();
    }

    setConnectEnabled(enabled) {
        this.settings.connect = enabled;
        this.saveSettings();
    }

    setDisconnectEnabled(enabled) {
        this.settings.disconnect = enabled;
        this.saveSettings();
    }

    setErrorEnabled(enabled) {
        this.settings.error = enabled;
        this.saveSettings();
    }

    getSettings() {
        return { ...this.settings };
    }
}

// Global instance
window.audioManager = new AudioManager();
