// Tiny local review/picker server for avatar-generation candidates.
// No external dependencies — Node built-ins only.
//
// Run: node review-server.mjs
// Open: http://localhost:4747

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4747;

const PRODUCTION_DIR = path.join(__dirname, 'output', 'production');
const CHOSEN_DIR = path.join(__dirname, 'output', 'chosen');

const CANDIDATE_COUNT = 4;

// ---- discovery -------------------------------------------------------

function discover() {
  const employees = [];

  let employeeNames = [];
  try {
    employeeNames = fs
      .readdirSync(PRODUCTION_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch {
    return employees;
  }

  for (const employee of employeeNames) {
    const employeeDir = path.join(PRODUCTION_DIR, employee);
    let slotNames = [];
    try {
      slotNames = fs
        .readdirSync(employeeDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort();
    } catch {
      continue;
    }

    const slots = [];
    for (const slot of slotNames) {
      const slotDir = path.join(employeeDir, slot);
      const candidates = [];
      for (let n = 1; n <= CANDIDATE_COUNT; n++) {
        const file = path.join(slotDir, `candidate-${n}.png`);
        if (fs.existsSync(file)) {
          candidates.push(n);
        }
      }
      if (candidates.length > 0) {
        const pickedPath = path.join(CHOSEN_DIR, employee, `${slot}.png`);
        slots.push({
          slot,
          candidates,
          picked: fs.existsSync(pickedPath),
        });
      }
    }

    if (slots.length > 0) {
      employees.push({ employee, slots });
    }
  }

  return employees;
}

// ---- safety helpers ----------------------------------------------------

function isSafeSegment(seg) {
  return typeof seg === 'string' && seg.length > 0 && !seg.includes('..') && !seg.includes('/') && !seg.includes('\\');
}

// ---- HTTP plumbing -------------------------------------------------------

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) {
        reject(new Error('body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    // GET / -> the review UI
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(HTML_PAGE);
      return;
    }

    // GET /status -> current discovery + pick state
    if (req.method === 'GET' && url.pathname === '/status') {
      const employees = discover();
      const total = employees.reduce((sum, e) => sum + e.slots.length, 0);
      const picked = employees.reduce(
        (sum, e) => sum + e.slots.filter((s) => s.picked).length,
        0
      );
      sendJson(res, 200, { employees, total, picked });
      return;
    }

    // GET /image?employee=..&slot=..&candidateNumber=.. -> serve a candidate PNG
    if (req.method === 'GET' && url.pathname === '/image') {
      const employee = url.searchParams.get('employee');
      const slot = url.searchParams.get('slot');
      const candidateNumber = url.searchParams.get('candidateNumber');

      if (!isSafeSegment(employee) || !isSafeSegment(slot) || !/^[1-4]$/.test(candidateNumber || '')) {
        sendJson(res, 400, { error: 'invalid params' });
        return;
      }

      const filePath = path.join(
        PRODUCTION_DIR,
        employee,
        slot,
        `candidate-${candidateNumber}.png`
      );

      if (!filePath.startsWith(PRODUCTION_DIR) || !fs.existsSync(filePath)) {
        sendJson(res, 404, { error: 'not found' });
        return;
      }

      const stat = fs.statSync(filePath);
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Content-Length': stat.size,
        'Cache-Control': 'no-cache',
      });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    // POST /pick -> copy chosen candidate into output/chosen/{employee}/{slot}.png
    if (req.method === 'POST' && url.pathname === '/pick') {
      const raw = await readBody(req);
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        sendJson(res, 400, { error: 'invalid json' });
        return;
      }

      const { employee, slot, candidateNumber } = body || {};

      if (
        !isSafeSegment(employee) ||
        !isSafeSegment(slot) ||
        !Number.isInteger(candidateNumber) ||
        candidateNumber < 1 ||
        candidateNumber > CANDIDATE_COUNT
      ) {
        sendJson(res, 400, { error: 'invalid params' });
        return;
      }

      const srcPath = path.join(
        PRODUCTION_DIR,
        employee,
        slot,
        `candidate-${candidateNumber}.png`
      );

      if (!srcPath.startsWith(PRODUCTION_DIR) || !fs.existsSync(srcPath)) {
        sendJson(res, 404, { error: 'candidate not found' });
        return;
      }

      const destDir = path.join(CHOSEN_DIR, employee);
      fs.mkdirSync(destDir, { recursive: true });
      const destPath = path.join(destDir, `${slot}.png`);

      if (!destPath.startsWith(CHOSEN_DIR)) {
        sendJson(res, 400, { error: 'invalid destination' });
        return;
      }

      fs.copyFileSync(srcPath, destPath); // copy, never move — originals stay put

      sendJson(res, 200, { ok: true, employee, slot, candidateNumber });
      return;
    }

    sendJson(res, 404, { error: 'not found' });
  } catch (err) {
    sendJson(res, 500, { error: String(err && err.message ? err.message : err) });
  }
});

server.listen(PORT, () => {
  console.log(`Avatar review server running at http://localhost:${PORT}`);
});

// ---- the page ------------------------------------------------------------

const HTML_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Avatar Candidate Review</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    margin: 0;
    background: #f4f5f7;
    color: #1a1a1a;
  }
  header {
    position: sticky;
    top: 0;
    z-index: 10;
    background: #1a1a1a;
    color: #fff;
    padding: 14px 20px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    box-shadow: 0 2px 6px rgba(0,0,0,0.15);
  }
  header h1 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
  }
  #progress {
    font-size: 15px;
    font-weight: 600;
  }
  #progress .bar {
    display: inline-block;
    width: 140px;
    height: 8px;
    background: #444;
    border-radius: 4px;
    overflow: hidden;
    margin-left: 10px;
    vertical-align: middle;
  }
  #progress .bar-fill {
    height: 100%;
    background: #4caf50;
    width: 0%;
    transition: width 0.2s ease;
  }
  main {
    padding: 20px;
    max-width: 1400px;
    margin: 0 auto;
  }
  .employee-section {
    margin-bottom: 40px;
  }
  .employee-section h2 {
    text-transform: capitalize;
    font-size: 22px;
    border-bottom: 2px solid #ccc;
    padding-bottom: 6px;
    margin-bottom: 16px;
  }
  .slot-block {
    background: #fff;
    border-radius: 10px;
    padding: 14px 16px;
    margin-bottom: 14px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    transition: background 0.2s ease;
  }
  .slot-block.picked {
    background: #eaf7ea;
  }
  .slot-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
  }
  .slot-name {
    font-weight: 600;
    font-size: 15px;
  }
  .slot-status {
    font-size: 13px;
    color: #888;
  }
  .slot-block.picked .slot-status {
    color: #2e7d32;
    font-weight: 600;
  }
  .candidates {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
  }
  .candidate {
    text-align: center;
    cursor: pointer;
    border: 3px solid transparent;
    border-radius: 8px;
    padding: 6px;
    transition: border-color 0.15s ease, transform 0.1s ease;
    background: #fafafa;
  }
  .candidate:hover {
    border-color: #90caf9;
    transform: translateY(-2px);
  }
  .candidate.selected {
    border-color: #4caf50;
    background: #f1fff1;
  }
  .candidate img {
    display: block;
    width: 220px;
    height: 220px;
    object-fit: contain;
    background: #f0f0f0;
    border-radius: 4px;
  }
  .candidate .label {
    margin-top: 6px;
    font-size: 13px;
    font-weight: 500;
    color: #444;
  }
  .candidate.selected .label {
    color: #2e7d32;
  }
  .empty-state {
    padding: 40px;
    text-align: center;
    color: #777;
    font-size: 15px;
  }
</style>
</head>
<body>
<header>
  <h1>Avatar Candidate Review</h1>
  <div id="progress">
    <span id="progress-text">Loading...</span>
    <span class="bar"><span class="bar-fill" id="progress-bar-fill"></span></span>
  </div>
</header>
<main id="main">
  <div class="empty-state">Loading current candidates...</div>
</main>

<script>
async function loadStatus() {
  const res = await fetch('/status');
  const data = await res.json();
  render(data);
}

function render(data) {
  const main = document.getElementById('main');
  const progressText = document.getElementById('progress-text');
  const progressBarFill = document.getElementById('progress-bar-fill');

  progressText.textContent = data.picked + ' / ' + data.total + ' picked';
  const pct = data.total > 0 ? Math.round((data.picked / data.total) * 100) : 0;
  progressBarFill.style.width = pct + '%';

  if (!data.employees || data.employees.length === 0) {
    main.innerHTML = '<div class="empty-state">No candidates found yet. Waiting for generation to produce files...</div>';
    return;
  }

  main.innerHTML = '';

  for (const emp of data.employees) {
    const section = document.createElement('section');
    section.className = 'employee-section';

    const heading = document.createElement('h2');
    heading.textContent = emp.employee;
    section.appendChild(heading);

    for (const slotInfo of emp.slots) {
      section.appendChild(renderSlot(emp.employee, slotInfo));
    }

    main.appendChild(section);
  }
}

function renderSlot(employee, slotInfo) {
  const block = document.createElement('div');
  block.className = 'slot-block' + (slotInfo.picked ? ' picked' : '');
  block.dataset.employee = employee;
  block.dataset.slot = slotInfo.slot;
  block.dataset.countedPicked = slotInfo.picked ? '1' : '0';

  const header = document.createElement('div');
  header.className = 'slot-header';

  const name = document.createElement('span');
  name.className = 'slot-name';
  name.textContent = slotInfo.slot;

  const status = document.createElement('span');
  status.className = 'slot-status';
  status.textContent = slotInfo.picked ? 'Picked' : 'Not picked';

  header.appendChild(name);
  header.appendChild(status);
  block.appendChild(header);

  const candidatesRow = document.createElement('div');
  candidatesRow.className = 'candidates';

  for (const n of slotInfo.candidates) {
    const card = document.createElement('div');
    card.className = 'candidate';
    card.dataset.candidateNumber = n;

    const img = document.createElement('img');
    img.src = '/image?employee=' + encodeURIComponent(employee) +
      '&slot=' + encodeURIComponent(slotInfo.slot) +
      '&candidateNumber=' + n;
    img.loading = 'lazy';
    img.alt = 'candidate ' + n;

    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = 'Pick #' + n;

    card.appendChild(img);
    card.appendChild(label);

    card.addEventListener('click', () => pick(employee, slotInfo.slot, n, block, card));

    candidatesRow.appendChild(card);
  }

  block.appendChild(candidatesRow);
  return block;
}

async function pick(employee, slot, candidateNumber, block, clickedCard) {
  try {
    const res = await fetch('/pick', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employee, slot, candidateNumber }),
    });
    if (!res.ok) {
      alert('Pick failed, try again.');
      return;
    }

    block.classList.add('picked');
    const status = block.querySelector('.slot-status');
    status.textContent = 'Picked';

    for (const card of block.querySelectorAll('.candidate')) {
      card.classList.toggle('selected', card === clickedCard);
    }

    updateProgressAfterPick(block);
  } catch (err) {
    alert('Pick failed: ' + err.message);
  }
}

async function updateProgressAfterPick(block) {
  // Refresh overall counts without a full re-render (keeps interaction fast).
  const wasAlreadyPicked = block.dataset.countedPicked === '1';
  if (!wasAlreadyPicked) {
    block.dataset.countedPicked = '1';
    const progressText = document.getElementById('progress-text');
    const parts = progressText.textContent.split(' / ');
    const picked = parseInt(parts[0], 10) + 1;
    const total = parseInt(parts[1], 10);
    progressText.textContent = picked + ' / ' + total + ' picked';
    const pct = total > 0 ? Math.round((picked / total) * 100) : 0;
    document.getElementById('progress-bar-fill').style.width = pct + '%';
  }
}

loadStatus();
</script>
</body>
</html>`;
