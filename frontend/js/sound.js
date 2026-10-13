// EDRecommend's intro sting: a two-beat "ta-DUM", synthesised live with the Web Audio API
// (no audio file). Browsers only allow sound after a click, so it plays when someone picks
// a profile. It can be switched off from the avatar menu.

const KEY = 'edr-sound';
let ctx = null;

export const soundOn = () => { try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; } };
export function setSound(on) { try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* private mode */ } }

/** A short generated room echo so the "DUM" rings out. */
function reverb(ac, seconds = 2.4) {
  const rate = ac.sampleRate;
  const buffer = ac.createBuffer(2, rate * seconds, rate);
  for (let ch = 0; ch < 2; ch += 1) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i += 1) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 3.2);
  }
  const node = ac.createConvolver();
  node.buffer = buffer;
  return node;
}

/** One hit: a pitched body that drops, a warm chord layer and a soft attack transient. */
function hit(ac, out, at, { pitch, length, gain, chord = [] }) {
  // Body: sine that drops in pitch (gives the "boom").
  const body = ac.createOscillator();
  const bodyGain = ac.createGain();
  body.type = 'sine';
  body.frequency.setValueAtTime(pitch * 2.2, at);
  body.frequency.exponentialRampToValueAtTime(pitch, at + 0.08);
  bodyGain.gain.setValueAtTime(0.0001, at);
  bodyGain.gain.exponentialRampToValueAtTime(gain, at + 0.012);
  bodyGain.gain.exponentialRampToValueAtTime(0.0001, at + length);
  body.connect(bodyGain).connect(out);
  body.start(at); body.stop(at + length + 0.05);

  // Warm layer: detuned saws through a closing low-pass filter.
  const filter = ac.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(2400, at);
  filter.frequency.exponentialRampToValueAtTime(260, at + length * 0.8);
  filter.Q.value = 1.2;
  const layerGain = ac.createGain();
  layerGain.gain.setValueAtTime(0.0001, at);
  layerGain.gain.exponentialRampToValueAtTime(gain * 0.32, at + 0.03);
  layerGain.gain.exponentialRampToValueAtTime(0.0001, at + length);
  filter.connect(layerGain).connect(out);
  [pitch, ...chord].forEach((f, i) => {
    [-7, 7].forEach((detune) => {
      const osc = ac.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = f * (i === 0 ? 2 : 1);
      osc.detune.value = detune;
      osc.connect(filter);
      osc.start(at); osc.stop(at + length + 0.05);
    });
  });

  // Attack: a tiny filtered noise burst.
  const noise = ac.createBufferSource();
  const buf = ac.createBuffer(1, ac.sampleRate * 0.05, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i += 1) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  noise.buffer = buf;
  const hp = ac.createBiquadFilter();
  hp.type = 'bandpass';
  hp.frequency.value = 1800;
  const ng = ac.createGain();
  ng.gain.value = gain * 0.35;
  noise.connect(hp).connect(ng).connect(out);
  noise.start(at);
}

/** Play "ta-DUM". Silently does nothing if sound is off or the browser blocks audio. */
export async function playIntro() {
  if (!soundOn()) return;
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') await ctx.resume();
    if (ctx.state !== 'running') return;
    const master = ctx.createGain();
    master.gain.value = 0.45;
    const comp = ctx.createDynamicsCompressor();
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    const room = reverb(ctx);
    master.connect(comp).connect(ctx.destination);
    master.connect(room).connect(wet).connect(ctx.destination);

    const now = ctx.currentTime + 0.05;
    // "ta" — short and lighter.
    hit(ctx, master, now, { pitch: 73.4, length: 0.28, gain: 0.55 });
    // "DUM" — deeper, longer, with a fifth and an octave for weight.
    hit(ctx, master, now + 0.32, { pitch: 55, length: 1.9, gain: 0.95, chord: [82.4, 110] });
  } catch { /* audio unavailable — the app works the same without it */ }
}
