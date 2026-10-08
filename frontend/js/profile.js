// Profile page: identity, editable interests, stats, taste radar chart, top tags.
import { $, esc, toast, countUp } from './utils.js';
import { state, taste, clearHistory } from './api.js';
import { updateProfile } from './auth.js';
import { say } from './robot.js';

let chart = null;

function loadChartJs() {
  if (window.Chart) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('Chart library failed to load.'));
    document.head.append(s);
  });
}

function interestChips() {
  const list = state.profile.interests || [];
  return list.length
    ? list.map((t) => `<button class="chip" data-del-interest="${esc(t)}" aria-label="Remove interest ${esc(t)}">${esc(t)} <span aria-hidden="true">×</span></button>`).join('')
    : '<p class="muted">No interests yet — add a few below.</p>';
}

export async function renderProfile(onProfileChange) {
  const root = $('#profile-root');
  const p = state.profile;
  root.innerHTML = `
    <div class="profile-grid stagger">
      <div class="box" style="--i:0">
        <div class="profile-id">
          <div class="avatar" aria-hidden="true">${esc((p.name || '?')[0].toUpperCase())}</div>
          <div><h2>${esc(p.name || 'Explorer')}</h2><p class="muted">${esc(state.user.email)}</p></div>
        </div>
        <form class="inline-form" id="name-form"><input name="name" maxlength="60" value="${esc(p.name)}" aria-label="Your name"><button class="btn ghost sm">Save name</button></form>
        <h3 style="margin:22px 0 10px">Interests</h3>
        <div class="chips wrap" id="my-interests" style="margin-top:0">${interestChips()}</div>
        <form class="inline-form" id="interest-form"><input name="interest" maxlength="40" placeholder="Add an interest" aria-label="Add an interest"><button class="btn ghost sm">Add</button></form>
      </div>
      <div class="box" style="--i:1">
        <h3>Activity</h3>
        <div class="stats" id="stats">${['Likes', 'Saves', 'Searches', 'Views'].map((l) => `<div class="stat"><b data-stat="${l.toLowerCase()}">–</b><span>${l}</span></div>`).join('')}</div>
        <h3 style="margin:22px 0 10px">Top tags</h3>
        <div class="tags" id="top-tags"><span class="muted">Loading…</span></div>
      </div>
      <div class="box full" style="--i:2">
        <h3>Taste profile</h3>
        <p class="muted" style="margin:-8px 0 12px">How strongly you engage with each category (likes, saves, views — recent counts more).</p>
        <div class="chart-wrap"><canvas id="taste-chart" aria-label="Radar chart of category affinity" role="img"></canvas></div>
      </div>
      <div class="box full" style="--i:3">
        <div class="row-between">
          <div><h3>Privacy</h3><p class="muted">Your history is only visible to you. Clearing it resets your recommendations.</p></div>
          <button class="btn danger" id="clear-history">Clear my history</button>
        </div>
      </div>
    </div>`;

  $('#name-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = e.target.name.value.trim();
    if (!name) return toast('Name can’t be empty.', 'error');
    await save({ name }, 'Name updated ✨');
    onProfileChange();
    renderProfile(onProfileChange);
  });
  $('#interest-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const value = e.target.interest.value.trim();
    if (!value) return;
    const list = [...new Set([...(state.profile.interests || []), value])].slice(0, 30);
    if (await save({ interests: list }, `Added “${value}”`)) renderProfile(onProfileChange);
  });
  $('#my-interests').addEventListener('click', async (e) => {
    const chip = e.target.closest('[data-del-interest]');
    if (!chip) return;
    const list = (state.profile.interests || []).filter((t) => t !== chip.dataset.delInterest);
    if (await save({ interests: list }, 'Interest removed')) renderProfile(onProfileChange);
  });
  $('#clear-history').addEventListener('click', async () => {
    if (!confirm('Clear all your likes, saves, views and searches? This can’t be undone.')) return;
    try {
      await clearHistory();
      toast('History cleared.', 'success');
      say('Fresh start! Let’s discover something new ✨');
      renderProfile(onProfileChange);
    } catch (err) { toast(err.message, 'error'); }
  });

  try {
    const data = await taste();
    const s = data.stats;
    const values = { likes: s.like, saves: s.save, searches: s.searches, views: s.view };
    Object.entries(values).forEach(([k, v]) => { const el = $(`[data-stat="${k}"]`); if (el) countUp(el, v || 0); });
    $('#top-tags').innerHTML = data.tags.length
      ? data.tags.map((t) => `<span class="tag weighted" style="--w:${t.weight}">${esc(t.tag)}</span>`).join('')
      : '<span class="muted">Like a few items to grow your tag cloud.</span>';
    await drawChart(data.categories);
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function save(fields, message) {
  try {
    state.profile = await updateProfile(state.user.id, fields);
    state.rowsStale = true;
    toast(message, 'success');
    return true;
  } catch {
    toast('Couldn’t save your profile. Please try again.', 'error');
    return false;
  }
}

async function drawChart(categories) {
  try { await loadChartJs(); } catch (err) { $('.chart-wrap').innerHTML = `<p class="muted">${esc(err.message)}</p>`; return; }
  const canvas = $('#taste-chart');
  if (!canvas) return;
  const css = getComputedStyle(document.documentElement);
  const text = css.getPropertyValue('--muted').trim();
  const grid = css.getPropertyValue('--border-strong').trim();
  chart?.destroy();
  const ctx = canvas.getContext('2d');
  const fill = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  fill.addColorStop(0, 'rgba(79,124,255,0.35)');
  fill.addColorStop(1, 'rgba(155,92,255,0.35)');
  chart = new window.Chart(ctx, {
    type: 'radar',
    data: {
      labels: categories.map((c) => c.name),
      datasets: [{
        label: 'Affinity', data: categories.map((c) => c.value),
        backgroundColor: fill, borderColor: '#7d6bff', borderWidth: 2,
        pointBackgroundColor: '#9b5cff', pointRadius: 3, pointHoverRadius: 6,
      }],
    },
    options: {
      maintainAspectRatio: false,
      animation: { duration: 1100, easing: 'easeOutQuart' },
      plugins: { legend: { display: false } },
      scales: {
        r: {
          min: 0, max: 100, ticks: { display: false, stepSize: 25 },
          grid: { color: grid }, angleLines: { color: grid },
          pointLabels: { color: text, font: { family: 'Plus Jakarta Sans', size: 12, weight: '600' } },
        },
      },
    },
  });
}
