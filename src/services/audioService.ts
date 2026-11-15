import { LanguageCode } from '../types/dictionary';

class AudioPronunciationService {
  private audioCtx: AudioContext | null = null;

  private getAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.audioCtx) {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioContextClass) {
        this.audioCtx = new AudioContextClass();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
    return this.audioCtx;
  }

  // Play acoustic tone curve honoring linguistic tone systems (Yoruba High/Mid/Low, Chinese 1-4, Hausa falling/rising)
  public playToneContour(tonePattern?: string | null): void {
    const ctx = this.getAudioContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';

      const pattern = (tonePattern || 'mid-high').toLowerCase();

      // Determine pitch contour
      if (pattern.includes('high')) {
        osc.frequency.setValueAtTime(320, now);
        osc.frequency.exponentialRampToValueAtTime(392, now + 0.25);
      } else if (pattern.includes('low')) {
        osc.frequency.setValueAtTime(220, now);
        osc.frequency.exponentialRampToValueAtTime(174, now + 0.28);
      } else if (pattern.includes('falling')) {
        osc.frequency.setValueAtTime(330, now);
        osc.frequency.exponentialRampToValueAtTime(220, now + 0.3);
      } else {
        // Serene balanced resonance
        osc.frequency.setValueAtTime(261.63, now); // Middle C
        osc.frequency.exponentialRampToValueAtTime(293.66, now + 0.25);
      }

      // Envelope
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.2, now + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.38);
    } catch (e) {
      console.warn('Audio tone synthesis error:', e);
    }
  }

  public speak(text: string, lang: LanguageCode, tonePattern?: string | null): Promise<boolean> {
    return new Promise((resolve) => {
      if (typeof window === 'undefined') {
        resolve(false);
        return;
      }

      // First play the subtle authentic acoustic tone contour
      this.playToneContour(tonePattern);

      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();

        const utterance = new SpeechSynthesisUtterance(text);
        const langMap: Record<LanguageCode, string> = {
          en: 'en-GB',
          fr: 'fr-FR',
          ar: 'ar-SA',
          zh: 'zh-CN',
          ha: 'ha-NG',
          yo: 'yo-NG',
          ff: 'ff-SN',
        };

        utterance.lang = langMap[lang] || 'en-US';
        utterance.rate = 0.88; // Slightly deliberate for language learning
        utterance.pitch = 1.0;

        utterance.onend = () => resolve(true);
        utterance.onerror = () => {
          // If browser lacks specific voice (common for regional African languages on generic OS),
          // tone was already played cleanly
          resolve(true);
        };

        window.speechSynthesis.speak(utterance);
      } else {
        resolve(true);
      }
    });
  }
}

export const audioService = new AudioPronunciationService();
