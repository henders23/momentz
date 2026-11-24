// Speaking instead of typing, using the browser's built-in speech recognition
// (Chrome, Edge and Safari). The words appear as the student says them.

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

export const speechSupported = Boolean(Recognition);

export class Recorder {
  /**
   * onText(final, interim)  called as words are recognised
   * onLevel(level)          called ~12 times a second with loudness from 0 to 1
   * onError(message)        called once if recording can't continue
   */
  constructor({ onText, onLevel, onError }) {
    this.onText = onText;
    this.onLevel = onLevel;
    this.onError = onError;
    this.active = false;
    this.committed = '';
    this.session = '';
    this.startedAt = 0;
  }

  start() {
    this.active = true;
    this.committed = '';
    this.session = '';
    this.interim = '';
    this.startedAt = Date.now();
    this.listen();
    this.meter();
  }

  listen() {
    const recognition = new Recognition();
    this.recognition = recognition;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || 'en-GB';

    recognition.onresult = (event) => {
      let final = '';
      let interim = '';
      for (const result of event.results) {
        if (result.isFinal) final += result[0].transcript;
        else interim += result[0].transcript;
      }
      this.session = final;
      this.interim = interim.trim();
      this.onText(this.text(), this.interim);
    };

    recognition.onerror = (event) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      const blocked = event.error === 'not-allowed' || event.error === 'service-not-allowed';
      this.fail(blocked ? 'Momentz needs permission to use your microphone. Allow it in your browser, or type instead.' : "Speech recognition stopped working. You can carry on by typing.");
    };

    // The browser ends a session after a pause; keep going until "Done".
    recognition.onend = () => {
      this.committed = this.text();
      this.session = '';
      if (this.active) this.listen();
      else this.ended?.();
    };

    try {
      recognition.start();
    } catch {
      this.fail("Couldn't start listening. You can carry on by typing.");
    }
  }

  // Loudness for the waveform. Purely decorative, so failures are ignored.
  async meter() {
    try {
      this.media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!this.active) return this.release();
      this.audio = new AudioContext();
      const analyser = this.audio.createAnalyser();
      analyser.fftSize = 256;
      this.audio.createMediaStreamSource(this.media).connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      this.ticker = setInterval(() => {
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (const s of samples) sum += ((s - 128) / 128) ** 2;
        this.onLevel(Math.min(1, Math.sqrt(sum / samples.length) * 5));
      }, 80);
    } catch {
      /* no waveform */
    }
  }

  text() {
    return `${this.committed} ${this.session}`.replace(/\s+/g, ' ').trim();
  }

  release() {
    clearInterval(this.ticker);
    this.media?.getTracks().forEach((track) => track.stop());
    this.audio?.close().catch(() => {});
    this.media = this.audio = null;
  }

  fail(message) {
    if (!this.active) return;
    this.stop();
    this.onError(message);
  }

  /**
   * Stop listening and return what was said. Waits briefly for the browser to
   * settle the last few words; if it doesn't, the unsettled words are kept.
   */
  async stop() {
    if (!this.active) return { text: this.text(), seconds: 0 };
    this.active = false;
    const seconds = Math.round((Date.now() - this.startedAt) / 1000);
    const settled = new Promise((resolve) => {
      this.ended = resolve;
      setTimeout(resolve, 1500);
    });
    try {
      this.recognition?.stop();
      await settled;
    } catch {
      /* already stopped */
    }
    this.release();
    const text = this.session || this.text().endsWith(this.interim) ? this.text() : `${this.text()} ${this.interim}`;
    return { text: text.trim(), seconds };
  }
}
