const AGENT_FLOW_COLORS = {
  Researcher: '#58a6ff',
  Ideator:    '#7c6af7',
  Engineer:   '#f59e0b',
  Critic:     '#ef4444',
  Presenter:  '#4ade80',
};

const AGENT_DEFS = [
  { key: "researcher", name: "Researcher", icon: "search"       },
  { key: "ideator",    name: "Ideator",    icon: "lightbulb"    },
  { key: "engineer",   name: "Engineer",   icon: "cpu"          },
  { key: "critic",     name: "Critic",     icon: "shield-alert" },
  { key: "presenter",  name: "Presenter",  icon: "mic"          },
];

const SESSION_KEY = "hivemind_session_v4";
const RESULTS_KEY = "hivemind_results";

const PHASE_STEP_MAP = {
  "Researcher": 0,
  "Ideator":    1,
  "Engineer":   2,
  "Critic":     3,
  "Presenter":  4,
};

const PHASE_KEYS  = ["idea", "idea", "idea", "critique", "verdict"];
const PHASE_LABELS = ["RESEARCH", "IDEATION", "ENGINEERING", "CRITIQUE", "PITCH"];

let selectedTeamSize = 2;
let ws = null;
let wsReconnectTimer = null;
let isRunning = false;
let lastReport = null;
let currentPhaseStep = -1;
let currentPhaseCards = [];
let currentPhaseCleanup = [];

let debateContainer = null;
let currentDebateBubble = null;
let debateActive = false;
let debateTurnCount = 0;

const DEBATE_AGENT_STYLES = {
  Engineer:   { color: '#f59e0b', bg: 'rgba(245,158,11,0.07)',  border: 'rgba(245,158,11,0.22)',  icon: 'cpu'          },
  Critic:     { color: '#ef4444', bg: 'rgba(239,68,68,0.07)',   border: 'rgba(239,68,68,0.22)',   icon: 'shield-alert' },
  Researcher: { color: '#58a6ff', bg: 'rgba(88,166,255,0.07)',  border: 'rgba(88,166,255,0.22)',  icon: 'search'       },
  Ideator:    { color: '#a78bf8', bg: 'rgba(167,139,248,0.07)', border: 'rgba(167,139,248,0.22)', icon: 'lightbulb'    },
};

let pingInterval = null;
let flowDoneCount = 0;
let flowTotalChars = 0;
let flowStartTime = null;
let flowTimer = null;

let headerRunStart = null;
let headerTokenCount = 0;
let headerStatsTimer = null;

const ideaInput       = document.getElementById("idea-input");
const runBtn          = document.getElementById("run-btn");
const statusBar       = document.getElementById("status-bar");
const statusText      = document.getElementById("status-text");
const reportSection   = document.getElementById("report-section");
const reportBody      = document.getElementById("report-body");
const agentFeed       = document.getElementById("agent-feed");
const agentSubtitle   = document.getElementById("agents-subtitle");
const wsDot           = document.getElementById("ws-status");
const wsLabel         = document.getElementById("ws-label");
const reportCopyBtn   = document.getElementById("report-copy-btn");
const phaseBar        = document.getElementById("phase-bar");
const progressBarWrap = document.getElementById("progress-bar-wrap");
const progressBar     = document.getElementById("progress-bar");
const headerStats     = document.getElementById("header-stats");
const headerTimer     = document.getElementById("header-timer");
const headerTokensEl  = document.getElementById("header-tokens");

const flowView   = document.getElementById('flow-view');
const btnFeed    = document.getElementById('btn-feed');
const btnFlow    = document.getElementById('btn-flow');

if (btnFeed) btnFeed.addEventListener('click', () => {
  btnFeed.classList.add('active');
  btnFlow.classList.remove('active');
  agentFeed.classList.remove('hidden');
  flowView.classList.add('hidden');
});
if (btnFlow) btnFlow.addEventListener('click', () => {
  btnFlow.classList.add('active');
  btnFeed.classList.remove('active');
  flowView.classList.remove('hidden');
  agentFeed.classList.add('hidden');
  icons();
});

const TOTAL_PHASES = 5;
function showProgress() {
  if (progressBarWrap) {
    progressBarWrap.classList.remove("hidden");
    setProgress(0);
  }
}
function setProgress(step) {
  if (progressBar) {
    const pct = Math.min((step / TOTAL_PHASES) * 100, 100);
    progressBar.style.width = pct + "%";
  }
}
function hideProgress() {
  if (progressBarWrap) progressBarWrap.classList.add("hidden");
}

function initDebateRoom() {
  // Collapse all existing agent card outputs above the debate room
  Object.entries(agentCardMap).forEach(([agentName, entry]) => {
    if (!entry || !entry.card || !entry.outputEl) return;
    const outputEl = entry.outputEl;
    if (outputEl.classList.contains('expanded')) {
      outputEl.classList.remove('expanded');
      if (!entry.card.querySelector('.output-toggle-btn')) {
        const btn = document.createElement('button');
        btn.className = 'output-toggle-btn';
        btn.textContent = `▼ Show ${agentName} output`;
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const nowExpanded = outputEl.classList.toggle('expanded');
          btn.textContent = nowExpanded ? `▲ Hide ${agentName} output` : `▼ Show ${agentName} output`;
        });
        entry.card.appendChild(btn);
      }
    }
  });

  const room = document.createElement('div');
  room.className = 'debate-room phase-enter';
  room.innerHTML = `
    <div class="debate-room-header">
      <span class="debate-room-title">⚡ DEBATE ROOM</span>
      <span class="debate-room-subtitle">agents choosing the best idea</span>
    </div>
    <div class="debate-bubbles"></div>
  `;
  agentFeed.appendChild(room);
  currentPhaseCards.push(room);
  currentPhaseCleanup.push(() => {
    debateContainer = null;
    currentDebateBubble = null;
    debateActive = false;
    debateTurnCount = 0;
  });
  debateContainer = room.querySelector('.debate-bubbles');
  debateActive = true;
  debateTurnCount = 0;
}

function createDebateBubble(agentName) {
  const cfg = DEBATE_AGENT_STYLES[agentName] || { color: '#7c6af7', bg: 'rgba(124,106,247,0.07)', border: 'rgba(124,106,247,0.22)', icon: 'message-circle' };
  const bubble = document.createElement('div');
  bubble.className = 'debate-bubble thinking';
  bubble.style.cssText = `background:#0d0d1a;border:1px solid #2a2a2a;border-left:3px solid ${cfg.color};padding:16px 20px`;
  bubble.innerHTML = `
    <div class="debate-bubble-header">
      <i data-lucide="${cfg.icon}" style="width:11px;height:11px;stroke-width:2.5;flex-shrink:0;color:${cfg.color}"></i>
      <span class="debate-bubble-name" style="color:${cfg.color};font-weight:700;text-transform:uppercase;font-size:0.7rem;letter-spacing:0.1em">${agentName}</span>
      ${debateTurnCount > 0 ? '<span class="debate-rebuttal-badge">REBUTTAL</span>' : ''}
      <span class="debate-bubble-dot" style="background:${cfg.color}"></span>
    </div>
    <div class="debate-bubble-text"></div>
  `;
  debateContainer.appendChild(bubble);
  requestAnimationFrame(() => bubble.classList.add('visible'));
  debateContainer.scrollTop = debateContainer.scrollHeight;
  icons();
  bubble._cfg = cfg;
  bubble._text = '';
  debateTurnCount++;
  return bubble;
}

function handleDebateMessage(msg) {
  if (msg.status === 'thinking') {
    currentDebateBubble = createDebateBubble(msg.agent);
  }
  if (msg.status === 'streaming' && currentDebateBubble && msg.token) {
    currentDebateBubble._text += msg.token;
    currentDebateBubble.className = 'debate-bubble streaming visible';
    const textEl = currentDebateBubble.querySelector('.debate-bubble-text');
    if (textEl) {
      textEl.textContent = currentDebateBubble._text;
      const cursor = document.createElement('span');
      cursor.className = 'debate-cursor';
      cursor.textContent = '█';
      textEl.appendChild(cursor);
    }
    if (debateContainer) debateContainer.scrollTop = debateContainer.scrollHeight;
  }
  if (msg.status === 'done' && currentDebateBubble) {
    currentDebateBubble.className = 'debate-bubble done visible';
    const dot = currentDebateBubble.querySelector('.debate-bubble-dot');
    if (dot) dot.style.background = 'var(--success)';
    const textEl = currentDebateBubble.querySelector('.debate-bubble-text');
    if (textEl) {
      const html = (typeof marked !== 'undefined')
        ? marked.parse(currentDebateBubble._text).replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        : currentDebateBubble._text;
      textEl.innerHTML = html;
    }
    currentDebateBubble = null;
  }
}

function finalizeDebate(chosenIdea) {
  if (!debateContainer) return;
  const banner = document.createElement('div');
  banner.className = 'debate-consensus';
  banner.innerHTML = `
    <span class="debate-consensus-label">✓ Consensus Reached</span>
    ${chosenIdea ? `<span class="debate-consensus-idea">${chosenIdea}</span>` : ''}
  `;
  debateContainer.appendChild(banner);
  requestAnimationFrame(() => banner.classList.add('visible'));
  if (debateContainer) debateContainer.scrollTop = debateContainer.scrollHeight;
  debateActive = false;
}

function startHeaderStats() {
  headerRunStart = Date.now();
  headerTokenCount = 0;
  if (headerStats) {
    headerStats.classList.remove("hidden");
    updateHeaderStats();
  }
  if (headerStatsTimer) clearInterval(headerStatsTimer);
  headerStatsTimer = setInterval(updateHeaderStats, 1000);
}

function updateHeaderStats() {
  if (!headerRunStart) return;
  const secs = Math.floor((Date.now() - headerRunStart) / 1000);
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  if (headerTimer) headerTimer.textContent = `⏱ ${m}:${s.toString().padStart(2, '0')}`;
  if (headerTokensEl) headerTokensEl.textContent = `${headerTokenCount.toLocaleString()} tok`;
}

function stopHeaderStats() {
  if (headerStatsTimer) { clearInterval(headerStatsTimer); headerStatsTimer = null; }
  updateHeaderStats();
  setTimeout(() => {
    if (headerStats) headerStats.classList.add("hidden");
    headerRunStart = null;
  }, 3000);
}

function burstParticles(originEl) {
  if (!originEl) return;
  const rect = originEl.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  for (let i = 0; i < 8; i++) {
    const p = document.createElement("div");
    p.className = "particle";
    p.style.left = cx + "px";
    p.style.top  = cy + "px";
    document.body.appendChild(p);
    const angle = (i / 8) * Math.PI * 2;
    const dist  = 40 + Math.random() * 40;
    const tx = Math.cos(angle) * dist;
    const ty = Math.sin(angle) * dist;
    p.animate([
      { transform: "translate(-50%, -50%) scale(1)",     opacity: 1 },
      { transform: `translate(calc(-50% + ${tx}px), calc(-50% + ${ty}px)) scale(0)`, opacity: 0 }
    ], { duration: 600, easing: "ease-out", fill: "forwards" }).onfinish = () => p.remove();
  }
}

if (typeof marked !== "undefined") {
  marked.setOptions({ breaks: true, gfm: true });
}

function icons() {
  if (typeof lucide !== "undefined") lucide.createIcons();
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function updateFlowStats() {
  const el = document.getElementById('flow-stats');
  if (!el) return;
  let elapsed = '0:00';
  if (flowStartTime) {
    const secs = Math.floor((Date.now() - flowStartTime) / 1000);
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    elapsed = `${m}:${s.toString().padStart(2, '00')}`;
  }
  el.textContent = `✓ ${flowDoneCount}/5 agents  ·  ${elapsed}  ·  ${flowTotalChars.toLocaleString()} chars`;
}

function fireContextBubble(agentIdx, color) {
  const connectors = document.querySelectorAll('.flow-connector');
  const conn = connectors[agentIdx];
  if (!conn) return;
  const bubble = document.createElement('div');
  bubble.className = 'ctx-bubble';
  bubble.style.cssText = `background:${color};border:1px solid ${hexToRgba(color,0.4)};top:0;`;
  bubble.textContent = 'context →';
  conn.appendChild(bubble);
  bubble.animate([
    { top: '0px',  opacity: 1, transform: 'translateX(-50%) scale(1)' },
    { top: '28px', opacity: 0, transform: 'translateX(-50%) scale(0.8)' },
  ], { duration: 1500, easing: 'ease-in', fill: 'forwards' }).onfinish = () => bubble.remove();
}

function updateFlowNode(agentName, status, token) {
  const node = document.querySelector(`.flow-node[data-agent="${agentName}"]`);
  if (!node) return;
  const color = AGENT_FLOW_COLORS[agentName] || '#7c6af7';
  const pill     = node.querySelector('.flow-node-pill');
  const pillText = pill.querySelector('.flow-pill-text');
  const pillDot  = pill.querySelector('.flow-pill-dot');
  const icon     = node.querySelector('.flow-node-icon');
  const bar      = node.querySelector('.flow-node-bar');
  const agentIdx = AGENT_DEFS.findIndex(a => a.name === agentName);
  const connectors = document.querySelectorAll('.flow-connector');

  if (status === 'thinking') {
    node.classList.add('fn-thinking');
    node.classList.remove('fn-done');
    node.style.borderColor      = color;
    node.style.backgroundColor  = hexToRgba(color, 0.06);
    node.style.boxShadow        = `0 0 20px ${hexToRgba(color, 0.12)}`;
    bar.style.boxShadow         = `0 0 8px ${color}, 0 0 16px ${hexToRgba(color, 0.5)}`;
    icon.style.borderColor      = color;
    icon.style.backgroundColor  = hexToRgba(color, 0.12);
    icon.querySelector('svg').style.color = color;
    pill.style.color            = color;
    pill.style.borderColor      = hexToRgba(color, 0.5);
    pill.style.backgroundColor  = hexToRgba(color, 0.1);
    pillText.textContent        = 'THINKING';
    pillDot.style.background    = color;
    if (agentIdx > 0) {
      const conn = connectors[agentIdx - 1];
      if (conn) {
        const prevColor = AGENT_FLOW_COLORS[AGENT_DEFS[agentIdx - 1].name] || '#7c6af7';
        conn.querySelector('.flow-connector-line').style.backgroundImage =
          `repeating-linear-gradient(to bottom, ${prevColor} 0, ${prevColor} 4px, transparent 4px, transparent 10px)`;
        conn.classList.add('flowing');
      }
    }
    if (!flowStartTime) {
      flowStartTime = Date.now();
      flowTimer = setInterval(updateFlowStats, 1000);
    }

  } else if (status === 'streaming' && token) {
    flowTotalChars += token.length;

  } else if (status === 'done') {
    node.classList.remove('fn-thinking');
    node.classList.add('fn-done');
    node.style.borderColor      = color;
    node.style.backgroundColor  = hexToRgba(color, 0.08);
    node.style.boxShadow        = `0 0 12px ${hexToRgba(color, 0.08)}`;
    icon.style.borderColor      = '#4ade80';
    icon.style.backgroundColor  = 'rgba(74,222,128,0.12)';
    icon.querySelector('svg').style.color = '#4ade80';
    pill.style.color            = '#4ade80';
    pill.style.borderColor      = 'rgba(74,222,128,0.4)';
    pill.style.backgroundColor  = 'rgba(74,222,128,0.08)';
    pillText.textContent        = 'DONE';
    pillDot.style.background    = '#4ade80';
    if (agentIdx > 0) {
      const conn = connectors[agentIdx - 1];
      if (conn) conn.classList.remove('flowing');
    }
    if (agentIdx < AGENT_DEFS.length - 1) {
      fireContextBubble(agentIdx, color);
    }
    flowDoneCount++;
    updateFlowStats();
  }
}

function resetFlowNodes() {
  document.querySelectorAll('.flow-node').forEach(node => {
    node.classList.remove('fn-thinking', 'fn-done');
    node.style.cssText = '';
    const pill = node.querySelector('.flow-node-pill');
    if (pill) {
      pill.style.cssText = '';
      const pt = pill.querySelector('.flow-pill-text');
      if (pt) pt.textContent = 'IDLE';
      const pd = pill.querySelector('.flow-pill-dot');
      if (pd) pd.style.background = '';
    }
    const icon = node.querySelector('.flow-node-icon');
    if (icon) {
      icon.style.cssText = '';
      const svg = icon.querySelector('svg');
      if (svg) svg.style.color = '';
    }
    const bar = node.querySelector('.flow-node-bar');
    if (bar) bar.style.boxShadow = '';
  });
  document.querySelectorAll('.flow-connector').forEach(conn => {
    conn.classList.remove('flowing');
    const line = conn.querySelector('.flow-connector-line');
    if (line) line.style.backgroundImage = '';
  });
  flowDoneCount   = 0;
  flowTotalChars  = 0;
  flowStartTime   = null;
  if (flowTimer) { clearInterval(flowTimer); flowTimer = null; }
  updateFlowStats();
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderMarkdown(md) {
  if (typeof marked !== "undefined") {
    return marked.parse(md).replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  }
  let html = esc(md);
  html = html.replace(/^###\s(.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^##\s(.+)$/gm,  '<h2>$1</h2>');
  html = html.replace(/^#\s(.+)$/gm,   '<h1>$1</h1>');
  html = html.replace(/^---+$/gm, '<hr>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g,     '<em>$1</em>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/((?:^[-*]\s.+\n?)+)/gm, (block) => {
    const items = block.trim().split('\n')
      .map(l => `<li>${l.replace(/^[-*]\s/, '')}</li>`).join('');
    return `<ul>${items}</ul>`;
  });
  html = html.split('\n\n').map(block => {
    block = block.trim();
    if (!block) return '';
    if (/^<[h1-6|t|u|p|d|h]/.test(block)) return block;
    return `<p>${block.replace(/\n/g, '<br>')}</p>`;
  }).join('\n');
  return html;
}

document.querySelectorAll('.team-pill').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.team-pill').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedTeamSize = parseInt(btn.dataset.size, 10);
    saveSession();
  });
});

function getSelectedAgentsConfig() {
  return AGENT_DEFS.map(d => {
    const card = document.querySelector(`.agent-sel-card[data-agent="${d.name}"]`);
    const sel  = card ? card.querySelector('.model-sel') : null;
    return { name: d.name, model: sel ? sel.value : 'gemini-2.5-flash' };
  });
}

function updateRunButton() {
  runBtn.disabled = ideaInput.value.trim().length === 0 || isRunning;
}

ideaInput.addEventListener("input", () => {
  updateRunButton();
  saveSession();
});

runBtn.addEventListener("click", startHivemind);

function startHivemind() {
  const theme = ideaInput.value.trim();
  if (isRunning || !theme) return;
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    setStatus("Not connected. Reconnecting...");
    return;
  }

  burstParticles(runBtn);

  const agents = getSelectedAgentsConfig();

  isRunning = true;
  runBtn.classList.add("running");
  runBtn.disabled = true;
  runBtn.querySelector(".run-label").textContent = "Running...";

  reportSection.classList.add("hidden");
  statusBar.classList.remove("hidden");
  setStatus("Sending theme to agents...");
  showProgress();
  startHeaderStats();
  initAgentCards();
  agentSubtitle.textContent = "Agents are live";

  phaseBar.classList.remove("hidden");
  currentPhaseStep = -1;
  phaseBar.querySelectorAll('.phase-step').forEach(s => {
    s.classList.remove('active', 'done');
  });

  ws.send(JSON.stringify({ type: "run", theme, team_size: selectedTeamSize, agents }));
}

function setStatus(msg) {
  statusText.textContent = msg;
}

const agentCardMap = {};

function initAgentCards() {
  agentFeed.innerHTML = "";
  Object.keys(agentCardMap).forEach(k => delete agentCardMap[k]);
  currentPhaseCards = [];
  currentPhaseCleanup = [];
  debateContainer = null;
  currentDebateBubble = null;
  debateActive = false;
  resetFlowNodes();
}

function createAgentCardElement(def) {
  const card = document.createElement("div");
  card.className = "agent-card idle";
  card.innerHTML = `
    <div class="agent-card-header">
      <div class="agent-icon-wrap"><i data-lucide="${def.icon}"></i></div>
      <span class="agent-name">${def.name}</span>
      <div class="agent-status-wrap">
        <span class="agent-status-dot"></span>
        <span class="agent-status-label">Idle</span>
      </div>
    </div>
    <div class="thinking-shimmer" style="display:none">
      <div class="shimmer-line"></div>
      <div class="shimmer-line"></div>
      <div class="shimmer-line"></div>
    </div>
    <div class="typing-indicator"><span></span><span></span><span></span></div>
    <div class="agent-output"></div>
  `;
  card.querySelector(".agent-card-header").addEventListener("click", () => {
    card.querySelector(".agent-output").classList.toggle("expanded");
  });
  return card;
}

function createPhaseCards(step) {
  const def = AGENT_DEFS[step];
  if (!def) return;

  const card = createAgentCardElement(def);
  card.classList.add("phase-enter");
  agentFeed.appendChild(card);
  currentPhaseCards.push(card);
  agentCardMap[def.name] = {
    card, text: "",
    shimmer: card.querySelector(".thinking-shimmer"),
    typingEl: card.querySelector(".typing-indicator"),
    outputEl: card.querySelector(".agent-output"),
    statusLabel: card.querySelector(".agent-status-label"),
  };
  currentPhaseCleanup.push(() => {
    if (agentCardMap[def.name]) { agentCardMap[def.name].text = ""; delete agentCardMap[def.name]; }
  });

  icons();
}

function updateAgentCard(agentName, status, token) {
  updateFlowNode(agentName, status, token);

  const entry = agentCardMap[agentName];
  if (!entry) return;
  if (entry.card.classList.contains("phase-exit")) return;
  const { card, shimmer, typingEl, outputEl, statusLabel } = entry;

  switch (status) {
    case "thinking":
      card.className = "agent-card thinking";
      statusLabel.textContent = "Thinking";
      shimmer.style.display = "flex";
      typingEl.style.display = "none";
      outputEl.textContent = "";
      outputEl.classList.remove("expanded", "streaming-cursor", "rendered");
      entry.text = "";
      break;

    case "streaming":
      if (card.className !== "agent-card streaming") {
        card.className = "agent-card streaming";
        statusLabel.textContent = "Streaming";
        shimmer.style.display = "none";
        typingEl.style.display = "flex";
      }
      if (token) {
        entry.text += token;
        headerTokenCount += token.length;
      }
      break;

    case "done":
      card.className = "agent-card done";
      statusLabel.textContent = "Done";
      shimmer.style.display = "none";
      typingEl.style.display = "none";
      outputEl.classList.remove("streaming-cursor");
      {
        const html = (typeof marked !== "undefined")
          ? marked.parse(entry.text).replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
          : renderMarkdown(entry.text);
        outputEl.innerHTML = html;
        outputEl.classList.add("expanded", "rendered");
      }
      break;

    case "error":
      card.className = "agent-card error";
      statusLabel.textContent = "Error";
      shimmer.style.display = "none";
      typingEl.style.display = "none";
      outputEl.textContent = token || "Unknown error";
      outputEl.classList.add("expanded");
      outputEl.classList.remove("streaming-cursor", "rendered");
      break;
  }
}

function onPhaseUpdate(phaseName) {
  const step = PHASE_STEP_MAP[phaseName];
  if (step === undefined) return;

  const oldCards = [...currentPhaseCards];
  const cleanupFns = [...currentPhaseCleanup];
  currentPhaseCards = [];
  currentPhaseCleanup = [];

  oldCards.forEach(el => el.classList.add("phase-exit"));

  const exitDuration = oldCards.length > 0 ? 300 : 0;

  setTimeout(() => {
    oldCards.forEach(el => el.remove());
    cleanupFns.forEach(fn => fn());

    phaseBar.querySelectorAll('.phase-step').forEach(el => {
      const s = parseInt(el.dataset.step, 10);
      el.classList.remove('active', 'done');
      if (s < step) el.classList.add('done');
      else if (s === step) el.classList.add('active');
    });
    currentPhaseStep = step;
    setProgress(step + 1);

    const phaseKey   = PHASE_KEYS[step]   || "idea";
    const phaseLabel = PHASE_LABELS[step] || phaseName;
    const banner = document.createElement("div");
    banner.className = `phase-transition-banner phase-${phaseKey}`;
    banner.textContent = `PHASE ${step + 1} — ${phaseLabel}`;
    agentFeed.appendChild(banner);
    setTimeout(() => banner.remove(), 1400);

    createPhaseCards(step);

  }, exitDuration);
}

function onPipelineComplete(msg) {
  isRunning = false;
  lastReport = msg.report || "";
  runBtn.classList.remove("running");
  runBtn.querySelector(".run-label").textContent = "Generate Ideas";
  statusBar.classList.add("hidden");
  updateRunButton();
  if (flowTimer) { clearInterval(flowTimer); flowTimer = null; }
  updateFlowStats();
  stopHeaderStats();

  phaseBar.querySelectorAll('.phase-step').forEach(el => {
    el.classList.remove('active');
    el.classList.add('done');
  });
  setProgress(TOTAL_PHASES);

  const resultsData = {
    outputs:   msg.outputs   || {},
    agents:    getSelectedAgentsConfig(),
    theme:     ideaInput.value.trim(),
    timestamp: new Date().toISOString(),
  };
  localStorage.setItem(RESULTS_KEY, JSON.stringify(resultsData));
  saveSession();

  runBtn.classList.add('flash-success');
  setTimeout(() => runBtn.classList.remove('flash-success'), 600);

  const wrap = document.getElementById('view-results-wrap');
  wrap.classList.remove('hidden');
  wrap.classList.add('view-results-visible');
}

document.getElementById('view-results-btn').addEventListener('click', () => {
  const appEl = document.getElementById('app');
  appEl.style.transition = 'opacity 400ms ease-out';
  appEl.style.opacity = '0';
  setTimeout(() => { window.location.href = '/results'; }, 420);
});

function onPipelineError(message) {
  isRunning = false;
  runBtn.classList.remove("running");
  runBtn.querySelector(".run-label").textContent = "Generate Ideas";
  setStatus("Error: " + message);
  stopHeaderStats();
  updateRunButton();
}

if (reportCopyBtn) {
  reportCopyBtn.addEventListener("click", () => {
    navigator.clipboard.writeText(reportBody.innerText).then(() => {
      reportCopyBtn.innerHTML = `<i data-lucide="check"></i> Copied`;
      icons();
      setTimeout(() => {
        reportCopyBtn.innerHTML = `<i data-lucide="copy"></i> Copy`;
        icons();
      }, 2000);
    });
  });
}

function connectWS() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws`);

  ws.onopen = () => {
    setWsStatus("connected", "Connected");
    clearTimeout(wsReconnectTimer);
  };
  ws.onclose = () => {
    setWsStatus("disconnected", "Disconnected");
    wsReconnectTimer = setTimeout(connectWS, 3000);
  };
  ws.onerror = () => {
    setWsStatus("reconnecting", "Reconnecting...");
  };
  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    handleWSMessage(msg);
  };

  if (!pingInterval) {
    pingInterval = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "ping" }));
      }
    }, 25000);
  }
}

function setWsStatus(state, label) {
  wsDot.className = "ws-dot " + state;
  wsLabel.textContent = label;
}

function handleWSMessage(msg) {
  switch (msg.type) {
    case "agent":         updateAgentCard(msg.agent, msg.status, msg.token); break;
    case "phase_update":  onPhaseUpdate(msg.phase); break;
    case "status":        setStatus(msg.message); break;
    case "complete":      onPipelineComplete(msg); break;
    case "error":         onPipelineError(msg.message); break;
    case "debate_start":  initDebateRoom(); break;
    case "debate":        handleDebateMessage(msg); break;
    case "debate_end":    finalizeDebate(msg.idea); break;
    case "pong":          break;
  }
}

function saveSession() {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      theme:    ideaInput.value,
      teamSize: selectedTeamSize,
    }));
  } catch {}
}

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return;
    const session = JSON.parse(raw);

    if (session.theme) ideaInput.value = session.theme;

    if (session.teamSize) {
      selectedTeamSize = session.teamSize;
      document.querySelectorAll('.team-pill').forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.dataset.size, 10) === selectedTeamSize);
      });
    }

    updateRunButton();
  } catch {}
}

connectWS();
loadSession();
initAgentCards();
updateRunButton();
icons();
