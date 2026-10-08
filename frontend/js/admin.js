// Admin tools (open /admin — not linked in the UI): stats, datasets, CSV import, users,
// cache rebuild, dedupe, demo reset, image upload.
// The backend re-checks is_admin on every call; hiding the UI is just convenience.
import { $, esc, toast, countUp } from './utils.js';
import { api, state } from './api.js';
import { sb } from './auth.js';
import { openModal, closeModal, itemCache } from './ui.js';
import { say } from './robot.js';

let onCatalogChange = () => {};

export function setCatalogChangeHandler(fn) { onCatalogChange = fn; }

export async function renderAdmin() {
  const root = $('#admin-root');
  if (!state.profile?.is_admin) {
    root.innerHTML = '<div class="empty"><span class="em">🔒</span><h3>Admins only</h3><p>Ask the project owner to set <code>is_admin</code> on your profile.</p></div>';
    return;
  }
  root.innerHTML = `
    <div class="admin-grid stagger">
      <div class="box" style="--i:0"><h3>Catalog stats</h3><div class="stats" id="admin-stats" style="grid-template-columns:repeat(2,1fr)">
        ${['users', 'items', 'interactions', 'searches'].map((k) => `<div class="stat"><b data-astat="${k}">–</b><span>${k[0].toUpperCase() + k.slice(1)}</span></div>`).join('')}
      </div></div>
      <div class="box" style="--i:1"><h3>Maintenance</h3>
        <p class="muted" style="margin-bottom:14px">The TF-IDF matrix is cached in memory and rebuilt automatically after imports.</p>
        <div class="admin-actions">
          <button class="btn ghost sm" data-admin="rebuild">↻ Rebuild cache</button>
          <button class="btn ghost sm" data-admin="dedupe">⧉ Remove duplicates</button>
          <button class="btn danger sm" data-admin="reset-demo">⟲ Reset demo data</button>
        </div>
      </div>
      <div class="box" style="--i:2"><h3>Import dataset</h3>
        <p class="muted" style="margin-bottom:14px">CSV up to 10 MB. Columns like title, description, tags, rating, image are detected automatically.</p>
        <button class="btn primary sm" data-open-import>+ Import Dataset</button>
      </div>
      <div class="box full" style="--i:2;grid-column:1/-1">
        <div class="row-between" style="margin-bottom:12px;gap:12px;flex-wrap:wrap">
          <div><h3>Datasets <span class="muted" style="font-weight:500">(data/ folder)</span></h3>
          <p class="muted">These CSV files are loaded into the catalog on startup. Sync after adding or editing a file.</p></div>
          <button class="btn ghost sm" data-admin="datasets/sync">⟳ Sync datasets</button>
        </div>
        <div id="datasets-table" class="table-wrap muted">Loading…</div>
      </div>
      <div class="box" style="--i:3"><h3>Item image</h3>
        <form id="image-form" class="stack">
          <label class="field"><span>Item</span><input name="q" list="item-titles" placeholder="Start typing a title…" autocomplete="off" required></label>
          <datalist id="item-titles"></datalist>
          <label class="field"><span>Image (PNG/JPG/WebP, max 2 MB)</span><input name="file" type="file" accept="image/png,image/jpeg,image/webp" required style="padding-top:10px"></label>
          <button class="btn ghost sm">Upload & attach</button>
        </form>
      </div>
      <div class="box full" style="--i:4;grid-column:1/-1"><h3>Users</h3><div id="users-table" class="table-wrap muted">Loading…</div></div>
      <div class="box full" style="--i:5;grid-column:1/-1"><h3>Recent imports</h3><div id="imports-table" class="table-wrap muted">Loading…</div></div>
    </div>`;

  root.querySelectorAll('[data-admin]').forEach((btn) => btn.addEventListener('click', () => runAction(btn)));
  $('#image-form').addEventListener('submit', uploadImage);
  $('#image-form [name=q]').addEventListener('input', suggestTitles);
  loadStats();
  loadDatasets();
  loadUsers();
}

async function loadDatasets() {
  const el = $('#datasets-table');
  try {
    const { files } = await api('/api/admin/datasets');
    el.classList.remove('muted');
    el.innerHTML = files.length
      ? `<table class="table"><thead><tr><th>File</th><th>Category</th><th>Rows</th><th>Images</th><th>In catalog</th><th>Size</th></tr></thead><tbody>
          ${files.map((f) => f.error
            ? `<tr><td>${esc(f.file)}</td><td colspan="5" style="color:var(--like)">${esc(f.error)}</td></tr>`
            : `<tr><td><b>${esc(f.file)}</b> ${f.builtin ? '<span class="pill">built-in</span>' : '<span class="pill ok">imported</span>'}</td>
                <td>${esc(f.categories.join(', '))}</td><td>${f.rows}</td>
                <td>${f.images ? `${f.images}/${f.rows}` : '<span class="muted">none</span>'}</td>
                <td>${f.in_catalog}</td><td>${f.size_kb} KB</td></tr>`).join('')}
        </tbody></table>`
      : '<p class="muted">No CSV files in data/ yet.</p>';
  } catch (err) { el.textContent = err.message; }
}

async function loadUsers() {
  const el = $('#users-table');
  try {
    const { users } = await api('/api/admin/users');
    el.classList.remove('muted');
    el.innerHTML = users.length
      ? `<table class="table"><thead><tr><th>Name</th><th>Username</th><th>Interests</th><th>Interactions</th><th>Role</th><th>Joined</th></tr></thead><tbody>
          ${users.map((u) => `<tr><td><b>${esc(u.name || '—')}</b></td><td>${esc(u.username || '—')}</td>
            <td>${esc((u.interests || []).slice(0, 5).join(', ') || '—')}</td><td>${u.interactions}</td>
            <td>${u.is_admin ? '<span class="pill ok">admin</span>' : '<span class="pill">user</span>'}</td>
            <td>${u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}</td></tr>`).join('')}
        </tbody></table>`
      : '<p class="muted">No users yet.</p>';
  } catch (err) { el.textContent = err.message; }
}

async function loadStats() {
  try {
    const s = await api('/api/admin/stats');
    ['users', 'items', 'interactions', 'searches'].forEach((k) => countUp($(`[data-astat="${k}"]`), s[k]));
    $('#imports-table').innerHTML = s.imports.length
      ? `<table class="table"><thead><tr><th>File</th><th>Read</th><th>Imported</th><th>Skipped</th><th>When</th></tr></thead><tbody>
          ${s.imports.map((r) => `<tr><td>${esc(r.filename)}</td><td>${r.rows_read}</td><td>${r.imported}</td><td>${r.skipped}</td><td>${new Date(r.created_at).toLocaleString()}</td></tr>`).join('')}
        </tbody></table>`
      : '<p class="muted">No imports yet.</p>';
  } catch (err) { toast(err.message, 'error'); }
}

async function runAction(btn) {
  const action = btn.dataset.admin;
  if (action === 'reset-demo' && !confirm('Delete all demo items and reload them? Interactions with demo items will be lost.')) return;
  btn.disabled = true; btn.classList.add('loading');
  try {
    const res = await api(`/api/admin/${action}`, { method: 'POST' });
    toast(res.message, 'success');
    say(res.message);
    onCatalogChange();
    loadStats();
    loadDatasets();
  } catch (err) { toast(err.message, 'error'); }
  finally { btn.disabled = false; btn.classList.remove('loading'); }
}

const suggestTitles = async (e) => {
  const q = e.target.value.trim();
  if (q.length < 2) return;
  const { data } = await sb.from('items').select('id,title,category').ilike('title', `%${q}%`).limit(8);
  $('#item-titles').innerHTML = (data || []).map((i) => `<option value="${esc(i.title)}">${esc(i.category)}</option>`).join('');
};

async function uploadImage(e) {
  e.preventDefault();
  const form = e.target;
  const file = form.file.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) return toast('Please choose an image under 2 MB.', 'error');
  const btn = form.querySelector('button');
  btn.disabled = true; btn.classList.add('loading');
  try {
    const { data: matches } = await sb.from('items').select('id,title').eq('title', form.q.value.trim()).limit(1);
    if (!matches?.length) throw new Error('Pick an item title from the suggestions.');
    const item = matches[0];
    const path = `${item.id}-${Date.now()}.${file.name.split('.').pop().toLowerCase()}`;
    const up = await sb.storage.from('item-images').upload(path, file, { contentType: file.type, upsert: true });
    if (up.error) throw new Error('Upload failed — check the item-images bucket policies.');
    const url = sb.storage.from('item-images').getPublicUrl(path).data.publicUrl;
    const { error } = await sb.from('items').update({ image_url: url }).eq('id', item.id);
    if (error) throw new Error('Image uploaded, but the item could not be updated.');
    await api('/api/admin/refresh', { method: 'POST' });
    itemCache.delete(item.id);
    toast(`Image attached to “${item.title}”.`, 'success');
    form.reset();
    onCatalogChange();
  } catch (err) { toast(err.message, 'error'); }
  finally { btn.disabled = false; btn.classList.remove('loading'); }
}

// ------------------------------------------------------------------ import modal
export function openImportModal() {
  const options = state.categories.filter((c) => c !== 'All');
  openModal(`<div class="modal-pad">
    <h2 id="modal-title">Import dataset</h2>
    <p class="muted" style="margin:6px 0 18px">We map common column names automatically (title/name, overview/summary, genres/tags, vote_average/rating, poster/image…).</p>
    <label class="dropzone" id="dropzone" tabindex="0">
      <span class="em" aria-hidden="true">📄</span>
      <b>Drop a CSV here</b> or click to choose
      <p id="file-name" class="muted" style="margin-top:6px"></p>
      <input type="file" id="csv-file" accept=".csv,text/csv" hidden>
    </label>
    <label class="field" style="margin-top:16px"><span>Category (used if the file has no category column)</span>
      <input id="import-category" list="cat-list" placeholder="e.g. Movies or Podcasts" maxlength="60">
      <datalist id="cat-list">${options.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
    </label>
    <label class="check"><input type="checkbox" id="import-save" checked> Also save a copy to the <code>data/</code> folder</label>
    <p class="form-error" id="import-error" role="alert"></p>
    <button class="btn primary block" id="import-go" style="margin-top:16px" disabled>Import</button>
  </div>`);

  const drop = $('#dropzone'), input = $('#csv-file'), go = $('#import-go');
  let file = null;
  const pick = (f) => {
    $('#import-error').textContent = '';
    if (!f) return;
    if (!f.name.toLowerCase().endsWith('.csv')) { $('#import-error').textContent = 'Please choose a .csv file.'; return; }
    if (f.size > 10 * 1024 * 1024) { $('#import-error').textContent = 'That file is larger than 10 MB.'; return; }
    file = f;
    $('#file-name').textContent = `${f.name} · ${(f.size / 1024).toFixed(1)} KB`;
    go.disabled = false;
  };
  input.addEventListener('change', () => pick(input.files[0]));
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => pick(e.dataTransfer.files[0]));

  go.addEventListener('click', async () => {
    const form = new FormData();
    form.append('file', file);
    form.append('category', $('#import-category').value.trim());
    form.append('save_to_data', $('#import-save').checked);
    go.disabled = true; go.classList.add('loading'); go.textContent = 'Importing…';
    try {
      const res = await api('/api/import', { method: 'POST', form });
      showSummary(res);
    } catch (err) {
      $('#import-error').textContent = err.message;
      go.disabled = false; go.classList.remove('loading'); go.textContent = 'Import';
    }
  });
}

function showSummary(res) {
  const reasons = Object.entries(res.skip_reasons || {});
  $('#modal-body').innerHTML = `<div class="modal-pad view-enter">
    <h2 id="modal-title">${res.imported ? 'Import complete 🎉' : 'Nothing new imported'}</h2>
    <p class="muted" style="margin-top:6px">${esc(res.filename)}</p>
    <div class="summary-list">
      <div><span>Rows read</span><b>${res.rows_read}</b></div>
      <div><span>Imported</span><b style="color:var(--success)">${res.imported}</b></div>
      <div><span>Skipped</span><b>${res.skipped}</b></div>
      ${reasons.map(([r, n]) => `<div class="muted"><span>↳ ${esc(r)}</span><b>${n}</b></div>`).join('')}
      ${res.invalid_ratings ? `<div class="muted"><span>↳ invalid ratings set to empty</span><b>${res.invalid_ratings}</b></div>` : ''}
      ${res.saved_as ? `<div class="muted"><span>Saved as</span><b>${esc(res.saved_as)}</b></div>` : ''}
    </div>
    <button class="btn primary block" data-close-modal>Done</button>
  </div>`;
  if (res.imported) say(`Imported ${res.imported} new items! 🎉`);
  state.categories = ['All', ...(res.categories || [])];
  onCatalogChange();
  if ($('#datasets-table')) { loadStats(); loadDatasets(); }
}

export { closeModal };
