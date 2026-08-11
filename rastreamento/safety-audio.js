export function createSafetyAudio(button, storageKey = 'ficoSafetySound') {
  let context = null, enabled = false;
  const update = () => { button.textContent = enabled ? 'SOM ATIVO' : 'ATIVAR SOM'; button.classList.toggle('sound-active', enabled); button.setAttribute('aria-pressed', String(enabled)); };
  async function toggle() {
    if (!enabled) { enabled = true; localStorage.setItem(storageKey, '1'); update(); const AudioEngine = globalThis.AudioContext || globalThis.webkitAudioContext; if (!AudioEngine) return; context ||= new AudioEngine(); try { await context.resume(); } catch {} }
    else { enabled = false; localStorage.setItem(storageKey, '0'); }
    update();
  }
  function tone(frequency, start, duration, gain = .12) {
    if (!enabled || !context || context.state !== 'running') return;
    const oscillator = context.createOscillator(), volume = context.createGain(); oscillator.type = 'square'; oscillator.frequency.value = frequency;
    volume.gain.setValueAtTime(.0001, context.currentTime + start); volume.gain.exponentialRampToValueAtTime(gain, context.currentTime + start + .015); volume.gain.exponentialRampToValueAtTime(.0001, context.currentTime + start + duration);
    oscillator.connect(volume).connect(context.destination); oscillator.start(context.currentTime + start); oscillator.stop(context.currentTime + start + duration + .02);
  }
  function critical() { tone(880, 0, .18, .16); tone(660, .24, .18, .16); tone(880, .48, .3, .18); }
  function warning() { tone(540, 0, .18, .10); tone(540, .27, .18, .10); }
  button.onclick = toggle; button.setAttribute('aria-pressed', 'false'); update();
  return { critical, warning, get enabled() { return enabled; } };
}
