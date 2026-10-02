// Short, locally synthesized game sounds: no downloads or microphone access.
export function createSoundEffects(enabled = true) {
  let context = null;
  let master = null;
  const audible = () => enabled && context && context.state === 'running' && !document.hidden;
  function setEnabled(value) {
    enabled = Boolean(value);
    if (master && context) master.gain.setValueAtTime(enabled ? .3 : 0, context.currentTime);
  }
  function unlock() {
    if (!enabled) return;
    try {
      const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AudioContext) return;
      if (!context) {
        context = new AudioContext();
        master = context.createGain(); master.gain.value = .3; master.connect(context.destination);
      }
      if (context.state === 'suspended') return context.resume().catch(() => {});
      return Promise.resolve();
    } catch { /* Audio support must never interrupt a saved game. */ }
  }
  function tone(frequency, duration, offset = 0, type = 'sine', volume = .16) {
    if (!audible()) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const at = context.currentTime + offset;
    oscillator.type = type; oscillator.frequency.setValueAtTime(frequency, at);
    gain.gain.setValueAtTime(.0001, at);
    gain.gain.exponentialRampToValueAtTime(volume, at + .006);
    gain.gain.exponentialRampToValueAtTime(.0001, at + duration);
    oscillator.connect(gain); gain.connect(master);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    oscillator.start(at); oscillator.stop(at + duration + .01);
  }
  function roll() {
    if (!audible()) return;
    for (let i = 0; i < 10; i++) {
      const buffer = context.createBuffer(1, Math.floor(context.sampleRate * .055), context.sampleRate);
      const data = buffer.getChannelData(0);
      for (let j = 0; j < data.length; j++) data[j] = (Math.random() * 2 - 1) * Math.exp(-j / (data.length / 5));
      const source = context.createBufferSource(); const gain = context.createGain();
      const filter = context.createBiquadFilter();
      filter.type = 'bandpass'; filter.frequency.value = 1500 + i * 100;
      source.buffer = buffer; gain.gain.value = .25;
      source.connect(filter); filter.connect(gain); gain.connect(master);
      source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
      source.start(context.currentTime + i * .065);
    }
  }
  // These wrappers also protect gameplay when a browser's audio device vanishes.
  const safely = fn => (...args) => { try { return fn(...args); } catch { return undefined; } };
  return {
    unlock,
    setEnabled: safely(setEnabled),
    roll: safely(roll),
    step: safely(() => tone(440, .055, 0, 'triangle', .12)),
    arrive: safely(() => { tone(659, .12); tone(880, .18, .09); }),
    purchase: safely(() => { tone(523, .13); tone(659, .13, .09); tone(784, .22, .18); }),
  };
}

export function animationPause(milliseconds) {
  if (document.hidden || matchMedia('(prefers-reduced-motion: reduce)').matches) return Promise.resolve();
  return new Promise(resolve => {
    let timer;
    const finish = () => { clearTimeout(timer); document.removeEventListener('visibilitychange', hidden); resolve(); };
    const hidden = () => { if (document.hidden) finish(); };
    timer = setTimeout(finish, milliseconds);
    document.addEventListener('visibilitychange', hidden);
  });
}
