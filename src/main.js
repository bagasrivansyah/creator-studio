/**
 * Creator Studio — UI wiring.
 *
 * Flow: read the brief -> run tasks through the AI layer (or the clearly
 * labelled demo provider when Firebase is not configured) -> render results,
 * routing log, and stats -> save projects to Firestore / localStorage.
 */
import {
  TASKS,
  checkNanoAvailability,
  isFirebaseLive,
  runTask,
} from "./ai.js";
import { runDemoTask, SAMPLE_BRIEF } from "./demo.js";
import {
  ensureAnonymousAuth,
  firebaseProjectId,
  isConfigured,
} from "./firebase.js";
import { deleteProject, listProjects, saveProject } from "./store.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

let toastTimer = null;
function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, 3200);
}

async function copyText(text, label) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${label} copied.`);
  } catch {
    // Clipboard API needs a secure context; fall back to a prompt-less path.
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    toast(`${label} copied.`);
  }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const state = {
  uid: null,
  results: { hooks: null, caption: null, script: null, titles: null },
  selectedHook: null,
  routingLog: [],
  generating: false,
};

function readBrief() {
  return {
    topic: $("#input-topic").value.trim(),
    niche: $("#input-niche").value,
    angle: $("#input-angle").value,
    language: $("#input-language").value,
    durationSec: Number($("#input-duration").value),
  };
}

function routingPreference() {
  const checked = document.querySelector('input[name="routing"]:checked');
  return checked ? checked.value : "auto";
}

const ROUTING_EXPLAIN = {
  auto: "Auto: quick tasks run on-device with Gemini Nano; the full script and titles run in the cloud with Gemini.",
  prefer_on_device:
    "On-device first: every task tries Gemini Nano before falling back to the cloud. Works offline when Nano is downloaded.",
  cloud_only:
    "Cloud only: every task runs on Gemini in the cloud. Use this when you want maximum quality on every task.",
};

// ---------------------------------------------------------------------------
// Status pills
// ---------------------------------------------------------------------------

function setPill(id, text, tone, title) {
  const el = $(id);
  el.textContent = text;
  el.classList.remove("ok", "warn", "bad");
  if (tone) el.classList.add(tone);
  if (title) el.title = title;
}

async function initStatus() {
  // Firebase
  if (isConfigured) {
    setPill(
      "#pill-firebase",
      "Firebase: live",
      "ok",
      `Connected to project ${firebaseProjectId}.`
    );
  } else {
    setPill(
      "#pill-firebase",
      "Firebase: demo mode",
      "warn",
      "No Firebase config found. Add .env values to generate live."
    );
    $("#demo-banner").hidden = false;
  }

  // Network
  const updateNet = () => {
    if (navigator.onLine) {
      setPill("#pill-net", "Online", "ok", "Internet available.");
    } else {
      setPill(
        "#pill-net",
        "Offline",
        "warn",
        "No internet — on-device tasks still work when Nano is downloaded."
      );
    }
  };
  updateNet();
  window.addEventListener("online", updateNet);
  window.addEventListener("offline", updateNet);

  // Gemini Nano (Chrome Prompt API)
  const nano = await checkNanoAvailability();
  const nanoTone =
    nano.status === "available"
      ? "ok"
      : nano.status === "downloading" || nano.status === "downloadable"
        ? "warn"
        : "bad";
  setPill("#pill-nano", `Nano: ${nano.status}`, nanoTone, nano.detail);
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

function switchTab(tabId) {
  $$(".tab").forEach((tab) => {
    const active = tab.dataset.tab === tabId;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  $$(".tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `panel-${tabId}`);
  });
}

$$(".tab").forEach((tab) =>
  tab.addEventListener("click", () => switchTab(tab.dataset.tab))
);

// ---------------------------------------------------------------------------
// Routing log + stats
// ---------------------------------------------------------------------------

function sourceBadge(source) {
  if (source === "ON_DEVICE")
    return '<span class="log-badge device">On-device</span>';
  if (source === "IN_CLOUD")
    return '<span class="log-badge cloud">In cloud</span>';
  if (source === "DEMO") return '<span class="log-badge demo">Demo</span>';
  return '<span class="log-badge error">Error</span>';
}

function addRoutingEntry(entry) {
  state.routingLog.unshift(entry);
  const empty = $("#routing-log .log-empty");
  if (empty) empty.remove();

  const li = document.createElement("li");
  li.innerHTML = `
    <div class="log-head">
      <span class="log-task">${escapeHtml(entry.taskLabel)}</span>
      ${sourceBadge(entry.source)}
    </div>
    <div class="log-model">${escapeHtml(entry.modelName)}${entry.latencyMs ? ` · ${entry.latencyMs} ms` : ""}${entry.initMs ? ` · +${entry.initMs} ms model init` : ""}</div>
    <div class="log-why">${escapeHtml(entry.why)}</div>
    <div class="log-time">${escapeHtml(entry.time)}</div>
  `;
  $("#routing-log").prepend(li);
  updateStats();
}

function updateStats() {
  const real = state.routingLog.filter(
    (e) => e.source === "ON_DEVICE" || e.source === "IN_CLOUD"
  );
  const device = real.filter((e) => e.source === "ON_DEVICE").length;
  const cloud = real.filter((e) => e.source === "IN_CLOUD").length;
  $("#stat-device").textContent = device;
  $("#stat-cloud").textContent = cloud;
  const withLatency = real.filter((e) => e.latencyMs > 0);
  $("#stat-avg").textContent = withLatency.length
    ? `${Math.round(withLatency.reduce((s, e) => s + e.latencyMs, 0) / withLatency.length)} ms`
    : "–";
}

// ---------------------------------------------------------------------------
// Result rendering
// ---------------------------------------------------------------------------

function setMeta(taskId, record) {
  const meta = $(`#meta-${taskId}`);
  if (!record) {
    meta.innerHTML = "";
    return;
  }
  const badgeClass =
    record.source === "ON_DEVICE"
      ? "badge-device"
      : record.source === "IN_CLOUD"
        ? "badge-cloud"
        : "badge-demo";
  const badgeLabel =
    record.source === "ON_DEVICE"
      ? "On-device · Gemini Nano"
      : record.source === "IN_CLOUD"
        ? "Cloud · Gemini"
        : "Sample output";
  meta.innerHTML = `
    <span class="badge ${badgeClass}">${badgeLabel}</span>
    <span class="meta-text">${escapeHtml(record.modelName)}</span>
    ${record.latencyMs ? `<span class="meta-text">${record.latencyMs} ms</span>` : ""}
    ${record.usedFallbackModel ? `<span class="meta-text">· fallback model used</span>` : ""}
  `;
}

function setLoading(taskId, message) {
  $(`#result-${taskId}`).innerHTML = `
    <div class="loading"><div class="spinner" aria-hidden="true"></div><span>${escapeHtml(message)}</span></div>
  `;
}

function setError(taskId, message) {
  setMeta(taskId, null);
  $(`#result-${taskId}`).innerHTML = `
    <div class="error-box"><strong>Generation failed.</strong> ${escapeHtml(message)}</div>
  `;
}

function renderRaw(taskId, data) {
  const text =
    typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return `<pre class="raw-output">${escapeHtml(text)}</pre>`;
}

function renderHooks(record) {
  const data = record.data;
  if (!data.hooks || !Array.isArray(data.hooks)) {
    return renderRaw("hooks", data);
  }
  const items = data.hooks
    .map(
      (h, i) => `
    <li class="hook-item${state.selectedHook === h.text ? " selected" : ""}" data-hook="${escapeHtml(h.text)}" title="Click to use this hook in the script">
      <span class="hook-num">${String(i + 1).padStart(2, "0")}</span>
      <span class="hook-text">${escapeHtml(h.text)}</span>
      <span class="hook-type">${escapeHtml(h.type || "")}</span>
    </li>`
    )
    .join("");
  return `<ul class="hook-list">${items}</ul>
    <p class="panel-hint small">Click a hook to use it as the opening line of the script and caption.</p>`;
}

function renderCaption(record) {
  const data = record.data;
  if (!data.caption) return renderRaw("caption", data);
  const tags = (data.hashtags || [])
    .map((t) => `<span class="hashtag">#${escapeHtml(String(t).replace(/^#/, ""))}</span>`)
    .join("");
  return `
    <p class="caption-text">${escapeHtml(data.caption)}</p>
    <div class="hashtag-row">${tags}</div>
    ${data.callToAction ? `<p class="cta-line"><strong>Call to action:</strong> ${escapeHtml(data.callToAction)}</p>` : ""}
  `;
}

function renderScript(record) {
  const data = record.data;
  if (!data.scenes || !Array.isArray(data.scenes)) {
    return renderRaw("script", data);
  }
  const scenes = data.scenes
    .map(
      (s) => `
    <div class="scene">
      <div class="scene-head"><strong>Scene ${escapeHtml(s.scene)}</strong><span class="scene-dur">${escapeHtml(s.durationSec ?? "")}s</span></div>
      <p><span class="label">Visual · </span>${escapeHtml(s.visual)}</p>
      <p><span class="label">Voiceover · </span>${escapeHtml(s.voiceover)}</p>
      <p><span class="label">On-screen · </span><span class="onscreen">${escapeHtml(s.onscreenText)}</span></p>
    </div>`
    )
    .join("");
  return `
    ${data.title ? `<p class="script-title">${escapeHtml(data.title)}</p>` : ""}
    ${data.hookLine ? `<p class="script-hook">“${escapeHtml(data.hookLine)}”</p>` : ""}
    ${scenes}
    <div class="script-foot">
      <span>${data.closingLine ? `Closing: ${escapeHtml(data.closingLine)}` : ""}</span>
      <span>${data.totalDurationSec ? `Total ≈ ${escapeHtml(data.totalDurationSec)}s` : ""}</span>
    </div>
  `;
}

function renderTitles(record) {
  const data = record.data;
  if (!data.titles && !data.thumbnailTexts) return renderRaw("titles", data);
  const titles = (data.titles || [])
    .map((t) => `<li>${escapeHtml(t)}</li>`)
    .join("");
  const thumbs = (data.thumbnailTexts || [])
    .map((t) => `<li>${escapeHtml(t)}</li>`)
    .join("");
  return `
    <p class="subhead">Titles</p>
    <ul class="title-list">${titles}</ul>
    <p class="subhead">Thumbnail text</p>
    <ul class="thumb-list">${thumbs}</ul>
  `;
}

const RENDERERS = {
  hooks: renderHooks,
  caption: renderCaption,
  script: renderScript,
  titles: renderTitles,
};

function renderResult(taskId, record) {
  setMeta(taskId, record);
  const render = RENDERERS[taskId];
  $(`#result-${taskId}`).innerHTML = render(record);
  if (taskId === "hooks") {
    $$("#result-hooks .hook-item").forEach((item) => {
      item.addEventListener("click", () => {
        state.selectedHook = item.dataset.hook;
        $$("#result-hooks .hook-item").forEach((el) =>
          el.classList.toggle("selected", el === item)
        );
        toast("Hook selected — it will open the script.");
      });
    });
  }
  if (taskId === "titles") {
    $$("#result-titles li").forEach((item) => {
      item.addEventListener("click", () => copyText(item.textContent.trim(), "Text"));
    });
  }
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

function setBusy(busy) {
  state.generating = busy;
  $("#btn-generate-all").disabled = busy;
  $$(".task-buttons .btn").forEach((b) => (b.disabled = busy));
  $("#btn-generate-all").textContent = busy
    ? "Generating…"
    : "Generate full package";
}

function showNanoProgress(progress) {
  const box = $("#nano-progress");
  const bar = $("#nano-progress-bar");
  const label = $("#nano-progress-label");
  if (progress == null || progress >= 1) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  const pct = Math.round(progress * 100);
  bar.style.width = `${pct}%`;
  label.textContent = `Downloading Gemini Nano for on-device use… ${pct}%`;
}

async function runOneTask(taskId, { switchTabAfter = true } = {}) {
  const task = TASKS[taskId];
  const brief = readBrief();
  setLoading(taskId, `Generating ${task.label.toLowerCase()}…`);
  if (switchTabAfter) switchTab(taskId);

  const started = new Date();
  try {
    const record = isFirebaseLive()
      ? await runTask(task, brief, {
          routingPreference: routingPreference(),
          selectedHook: state.selectedHook,
          onDownloadProgress: showNanoProgress,
        })
      : await runDemoTask(task, brief);
    showNanoProgress(1);
    state.results[taskId] = record;
    renderResult(taskId, record);
    addRoutingEntry({
      taskLabel: task.label,
      source: record.source,
      modelName: record.modelName,
      latencyMs: record.latencyMs,
      initMs: record.initMs,
      why: record.why,
      time: started.toLocaleTimeString(),
    });
    if (!record.parseOk) {
      toast("The model replied in plain text instead of JSON — shown as-is.");
    }
    return record;
  } catch (err) {
    showNanoProgress(1);
    const message = friendlyError(err);
    setError(taskId, message);
    addRoutingEntry({
      taskLabel: task.label,
      source: "ERROR",
      modelName: err?.message ? String(err.message).slice(0, 120) : "Unknown error",
      latencyMs: 0,
      initMs: 0,
      why: "The request failed. Check the connection and the Firebase setup, then try again.",
      time: started.toLocaleTimeString(),
    });
    return null;
  }
}

function friendlyError(err) {
  const msg = String(err?.message || err || "");
  if (/404|not found/i.test(msg))
    return "The requested model was not found. The app already retried with the fallback model — please try again later.";
  if (/permission|API key not valid|API_KEY/i.test(msg))
    return "The Firebase project rejected the request (API key / App Check). Check the Firebase console setup.";
  if (/Failed to fetch|NetworkError|offline/i.test(msg))
    return "No network connection. On-device tasks still work when Gemini Nano is downloaded — try Hooks or Caption.";
  if (/only_on_device|on-device model/i.test(msg))
    return "Gemini Nano is not available in this browser. Switch routing to Auto or Cloud only.";
  return msg.slice(0, 300) || "Unknown error.";
}

async function generateAll() {
  const brief = readBrief();
  if (!brief.topic) {
    toast("Please enter a topic first.");
    $("#input-topic").focus();
    return;
  }
  setBusy(true);
  try {
    // Sequential: hooks first so the caption and script can reuse the
    // selected hook, and so the routing log tells the story in order.
    await runOneTask("hooks");
    if (!state.selectedHook && state.results.hooks?.data?.hooks?.[0]) {
      state.selectedHook = state.results.hooks.data.hooks[0].text;
      renderResult("hooks", state.results.hooks);
    }
    await runOneTask("caption");
    await runOneTask("script");
    await runOneTask("titles");
    switchTab("script");
    toast("Full package ready.");
  } finally {
    setBusy(false);
  }
}

$("#btn-generate-all").addEventListener("click", generateAll);

$$(".task-buttons .btn").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const brief = readBrief();
    if (!brief.topic) {
      toast("Please enter a topic first.");
      $("#input-topic").focus();
      return;
    }
    setBusy(true);
    try {
      await runOneTask(btn.dataset.task);
    } finally {
      setBusy(false);
    }
  });
});

// Routing preference explainer
$$('input[name="routing"]').forEach((input) => {
  input.addEventListener("change", () => {
    $("#routing-explain").textContent = ROUTING_EXPLAIN[input.value];
  });
});

// ---------------------------------------------------------------------------
// Copy + save
// ---------------------------------------------------------------------------

function buildPlainTextSummary() {
  const brief = readBrief();
  const lines = [
    `CREATOR STUDIO — ${brief.topic}`,
    `Niche: ${brief.niche} · Angle: ${brief.angle} · ${brief.durationSec}s`,
    "",
  ];
  const r = state.results;
  if (r.hooks?.data?.hooks) {
    lines.push("HOOKS:");
    r.hooks.data.hooks.forEach((h, i) =>
      lines.push(`${i + 1}. ${h.text} (${h.type || ""})`)
    );
    lines.push("");
  }
  if (r.caption?.data?.caption) {
    lines.push("CAPTION:");
    lines.push(r.caption.data.caption);
    lines.push((r.caption.data.hashtags || []).map((t) => `#${t}`).join(" "));
    if (r.caption.data.callToAction) lines.push(r.caption.data.callToAction);
    lines.push("");
  }
  if (r.script?.data?.scenes) {
    lines.push(`SCRIPT: ${r.script.data.title || ""}`);
    r.script.data.scenes.forEach((s) => {
      lines.push(
        `Scene ${s.scene} (${s.durationSec}s) — Visual: ${s.visual} | VO: ${s.voiceover} | Text: ${s.onscreenText}`
      );
    });
    if (r.script.data.closingLine) lines.push(`Closing: ${r.script.data.closingLine}`);
    lines.push("");
  }
  if (r.titles?.data?.titles) {
    lines.push("TITLES:");
    r.titles.data.titles.forEach((t) => lines.push(`- ${t}`));
    lines.push("THUMBNAIL TEXT:");
    (r.titles.data.thumbnailTexts || []).forEach((t) => lines.push(`- ${t}`));
  }
  return lines.join("\n");
}

$("#btn-copy-all").addEventListener("click", () => {
  const any = Object.values(state.results).some(Boolean);
  if (!any) {
    toast("Nothing to copy yet — generate something first.");
    return;
  }
  copyText(buildPlainTextSummary(), "Package");
});

$("#btn-save-project").addEventListener("click", async () => {
  const any = Object.values(state.results).some(Boolean);
  if (!any) {
    toast("Nothing to save yet — generate something first.");
    return;
  }
  const brief = readBrief();
  const project = {
    topic: brief.topic,
    niche: brief.niche,
    angle: brief.angle,
    language: brief.language,
    durationSec: brief.durationSec,
    outputs: {
      hooks: state.results.hooks?.data || null,
      caption: state.results.caption?.data || null,
      script: state.results.script?.data || null,
      titles: state.results.titles?.data || null,
    },
    sources: {
      hooks: state.results.hooks?.source || null,
      caption: state.results.caption?.source || null,
      script: state.results.script?.source || null,
      titles: state.results.titles?.source || null,
    },
    routing: state.routingLog.slice(0, 12),
  };
  const { store } = await saveProject(state.uid, project);
  toast(
    store === "firestore"
      ? "Project saved to Firestore."
      : "Project saved in this browser (local)."
  );
  refreshSavedList();
});

// ---------------------------------------------------------------------------
// Saved projects
// ---------------------------------------------------------------------------

async function refreshSavedList() {
  const list = $("#saved-list");
  const projects = await listProjects(state.uid);
  if (!projects.length) {
    list.innerHTML = '<p class="empty-state small">No saved projects yet.</p>';
    return;
  }
  list.innerHTML = "";
  for (const p of projects) {
    const card = document.createElement("div");
    card.className = "saved-card";
    const outputs = ["hooks", "caption", "script", "titles"]
      .filter((k) => p.outputs?.[k])
      .join(" · ");
    card.innerHTML = `
      <h3>${escapeHtml(p.topic || "Untitled")}</h3>
      <p>${escapeHtml(p.niche || "")} · ${escapeHtml(p.angle || "")} · ${escapeHtml(p.durationSec || 30)}s</p>
      <p class="saved-meta">${escapeHtml(outputs || "No outputs")} · ${escapeHtml(p.store === "firestore" ? "Firestore" : "Local")} · ${escapeHtml(p.updatedAtLabel || "")}</p>
      <div class="saved-actions">
        <button class="btn btn-ghost btn-small" data-action="load">Load</button>
        <button class="btn btn-ghost btn-small" data-action="delete">Delete</button>
      </div>
    `;
    card
      .querySelector('[data-action="load"]')
      .addEventListener("click", () => loadProject(p));
    card
      .querySelector('[data-action="delete"]')
      .addEventListener("click", async () => {
        if (await deleteProject(p)) {
          toast("Project deleted.");
          refreshSavedList();
        } else {
          toast("Could not delete that project.");
        }
      });
    list.appendChild(card);
  }
}

function loadProject(p) {
  $("#input-topic").value = p.topic || "";
  $("#input-niche").value = p.niche || "Islamic stories";
  $("#input-angle").value = p.angle || "Story / parable";
  $("#input-language").value = p.language || "en";
  $("#input-duration").value = String(p.durationSec || 30);

  for (const taskId of ["hooks", "caption", "script", "titles"]) {
    const data = p.outputs?.[taskId];
    if (!data) continue;
    const source = p.sources?.[taskId] || "DEMO";
    const record = {
      taskId,
      data,
      rawText: JSON.stringify(data),
      parseOk: true,
      source,
      modelName: source === "ON_DEVICE" ? "Gemini Nano 4 (on-device)" : source === "IN_CLOUD" ? "Gemini (cloud)" : "Sample output",
      latencyMs: 0,
      initMs: 0,
      requestedMode: null,
      why: "Loaded from a saved project.",
      usedFallbackModel: false,
    };
    state.results[taskId] = record;
    renderResult(taskId, record);
  }
  state.selectedHook = null;
  switchTab("hooks");
  toast("Project loaded.");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

$("#btn-refresh-saved").addEventListener("click", refreshSavedList);

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

(async function boot() {
  initStatus();

  // Pre-fill the topic with a sample so first-time visitors can generate
  // immediately and see the hybrid routing in action.
  if (!$("#input-topic").value) {
    $("#input-topic").value = SAMPLE_BRIEF.topic;
    $("#input-niche").value = SAMPLE_BRIEF.niche;
    $("#input-angle").value = SAMPLE_BRIEF.angle;
  }

  if (isConfigured) {
    state.uid = await ensureAnonymousAuth();
  }
  refreshSavedList();
})();
