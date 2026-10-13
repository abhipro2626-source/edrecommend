// The robot assistant: short, context-aware messages in a speech bubble.
import { $ } from './utils.js';

const TIPS = [
  'Tip: 👍 Like or 💖 Love things — Love counts extra and your rows update instantly.',
  'Tip: “Not for me” hides an item, and you can undo it from the message that pops up.',
  'Tip: open any card and read “Why we recommended this” to see the score breakdown.',
  'Tip: try searching “space movies”, “psychology books” or “learn python”.',
  'Tip: each profile has its own taste — switch profiles from your avatar menu.',
]

let hideTimer = null;
let idleTimer = null;
let surpriseHandler = null;
let clicks = 0;

/** Say something for a few seconds. */
export function say(text, ms = 3600) {
  const bubble = $('#robot-bubble');
  if (!bubble) return;
  bubble.textContent = text;
  bubble.classList.add('show');
  const btn = $('#robot-btn');
  btn.classList.remove('excited');
  void btn.offsetWidth;            // restart the hop animation
  btn.classList.add('excited');
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => bubble.classList.remove('show'), ms);
  resetIdle();
}

function resetIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => say('Try searching for something new. 🔍'), 30000);
}

/** onSurprise: async function that returns a message (and opens an item). */
export function initRobot(onSurprise) {
  surpriseHandler = onSurprise;
  $('#robot').hidden = false;
  setTimeout(() => say("I'm ready! ✨"), 900);
  if (initRobot.done) return;      // listeners are attached only once per page load
  initRobot.done = true;
  $('#robot-btn').addEventListener('click', async () => {
    clicks += 1;
    if (clicks % 2 === 1 && surpriseHandler) {
      say('Surprise! 🎁 Here’s something you might love…');
      try { await surpriseHandler(); } catch { say('Hmm, I couldn’t find a surprise right now.'); }
    } else {
      say(TIPS[Math.floor(Math.random() * TIPS.length)], 5200);
    }
  });
  ['pointerdown', 'keydown', 'scroll'].forEach((ev) => addEventListener(ev, resetIdle, { passive: true }));
}

/** Step aside (e.g. while the details overlay is open) without forgetting state. */
export function robotAway(away) {
  $('#robot')?.classList.toggle('away', away);
}

export function hideRobot() {
  $('#robot').hidden = true;
  clearTimeout(idleTimer);
}
