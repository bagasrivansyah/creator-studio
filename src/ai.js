/**
 * AI layer — Firebase AI Logic hybrid inference.
 *
 * Every task runs through `getGenerativeModel` with an explicit `InferenceMode`:
 *  - PREFER_ON_DEVICE: Gemini Nano in Chrome when available, cloud fallback.
 *  - ONLY_IN_CLOUD: cloud Gemini model only (for long-form reasoning).
 *  - PREFER_IN_CLOUD / ONLY_ON_DEVICE: available via the routing switch.
 *
 * After each call we read `response.inferenceSource` ("ON_DEVICE" |
 * "IN_CLOUD") so the UI can show, honestly, where the work actually ran.
 *
 * Cloud model names are pinned to documented stable models:
 *  - gemini-3.5-flash-lite — the documented SDK default fallback (fast, cheap),
 *    used for the small on-device-first tasks.
 *  - gemini-3.8-flash — documented stable Flash model, used for the
 *    long-form script and title tasks that need a stronger model.
 * If a named model ever returns 404 (retired/renamed), the call is retried
 * once with the other model before surfacing an error.
 */
import {
  getGenerativeModel,
  InferenceMode,
} from "firebase/ai";
import { getFirebaseAI, isConfigured } from "./firebase.js";
import {
  buildCaptionPrompt,
  buildHooksPrompt,
  buildScriptPrompt,
  buildTitlesPrompt,
  captionSchema,
  hooksSchema,
  ON_DEVICE_SYSTEM_PROMPT,
  scriptSchema,
  titlesSchema,
} from "./prompts.js";

export const CLOUD_MODEL_FAST = "gemini-3.5-flash-lite";
export const CLOUD_MODEL_STRONG = "gemini-3.8-flash";

/** Human-readable model labels for the routing panel. */
export const ON_DEVICE_MODEL_LABEL = "Gemini Nano 4 (on-device)";

const DEVICE_INIT_DONE = new WeakSet();

/**
 * Model instances are cached per (task, mode, cloud model, language).
 * Model configuration lives for the lifetime of the instance (per the
 * docs), and caching means `initializeDeviceModel()` runs once per model
 * instead of before every generation.
 */
const MODEL_CACHE = new Map();

function getCachedModel(cacheKey, buildFn) {
  let model = MODEL_CACHE.get(cacheKey);
  if (!model) {
    model = buildFn();
    MODEL_CACHE.set(cacheKey, model);
  }
  return model;
}

/**
 * Task definitions. `defaultMode` is the routing the app uses in "Auto":
 * small, private brainstorming goes to Nano first; long-form writing goes
 * straight to the cloud because it needs a larger model.
 */
export const TASKS = {
  hooks: {
    id: "hooks",
    label: "Hooks",
    defaultMode: InferenceMode.PREFER_ON_DEVICE,
    cloudModel: CLOUD_MODEL_FAST,
    schema: hooksSchema,
    buildPrompt: (brief) => buildHooksPrompt(brief),
    whyOnDevice:
      "Quick brainstorm — Nano is fast enough, and the topic never leaves the device.",
    whyCloud:
      "Nano isn't available in this browser, so the cloud model handled it.",
    whyCloudForced:
      "Long-form quality was requested, so the cloud model handled it.",
  },
  caption: {
    id: "caption",
    label: "Caption & hashtags",
    defaultMode: InferenceMode.PREFER_ON_DEVICE,
    cloudModel: CLOUD_MODEL_FAST,
    schema: captionSchema,
    buildPrompt: (brief, ctx) => buildCaptionPrompt(brief, ctx?.selectedHook),
    whyOnDevice:
      "Short, private text — ideal for on-device: fast, free, works offline.",
    whyCloud:
      "Nano isn't available in this browser, so the cloud model handled it.",
    whyCloudForced:
      "Cloud-only mode is on, so the cloud model handled it.",
  },
  script: {
    id: "script",
    label: "Full script",
    defaultMode: InferenceMode.ONLY_IN_CLOUD,
    cloudModel: CLOUD_MODEL_STRONG,
    schema: scriptSchema,
    buildPrompt: (brief, ctx) => buildScriptPrompt(brief, ctx?.selectedHook),
    whyOnDevice:
      "On-device-first mode is on — Nano wrote the full script locally.",
    whyCloud:
      "Long-form structure and reasoning need a larger cloud model.",
    whyCloudForced:
      "Long-form structure and reasoning need a larger cloud model.",
  },
  titles: {
    id: "titles",
    label: "Titles & thumbnail text",
    defaultMode: InferenceMode.ONLY_IN_CLOUD,
    cloudModel: CLOUD_MODEL_STRONG,
    schema: titlesSchema,
    buildPrompt: (brief) => buildTitlesPrompt(brief),
    whyOnDevice:
      "On-device-first mode is on — Nano wrote the titles locally.",
    whyCloud:
      "Nuanced wording and keyword craft benefit from a larger cloud model.",
    whyCloudForced:
      "Cloud-only mode is on, so the cloud model handled it.",
  },
};

/** User routing preference -> effective InferenceMode for a task. */
export function resolveMode(task, routingPreference) {
  if (routingPreference === "prefer_on_device")
    return InferenceMode.PREFER_ON_DEVICE;
  if (routingPreference === "cloud_only") return InferenceMode.ONLY_IN_CLOUD;
  return task.defaultMode; // "auto"
}

function modeUsesOnDevice(mode) {
  return (
    mode === InferenceMode.PREFER_ON_DEVICE ||
    mode === InferenceMode.ONLY_ON_DEVICE
  );
}

function modeUsesCloud(mode) {
  return mode !== InferenceMode.ONLY_ON_DEVICE;
}

function buildModel(task, mode, cloudModel, language) {
  const ai = getFirebaseAI();
  const params = { mode };

  if (modeUsesCloud(mode)) {
    params.inCloudParams = {
      model: cloudModel,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: task.schema,
      },
    };
  }

  if (modeUsesOnDevice(mode)) {
    params.onDeviceParams = {
      createOptions: {
        expectedInputs: [{ type: "text", languages: [language] }],
        expectedOutputs: [{ type: "text", languages: [language] }],
        initialPrompts: [
          {
            role: "system",
            content: [{ type: "text", value: ON_DEVICE_SYSTEM_PROMPT }],
          },
        ],
      },
      promptOptions: {
        responseConstraint: task.schema,
      },
    };
  }

  return getGenerativeModel(ai, params);
}

/** Strip markdown fences and parse JSON; returns { data, parseOk, rawText }. */
export function parseJsonOutput(rawText) {
  const cleaned = String(rawText || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return { data: JSON.parse(cleaned), parseOk: true, rawText };
  } catch {
    return { data: { _raw: rawText }, parseOk: false, rawText };
  }
}

function isModelNotFoundError(err) {
  const msg = String(err?.message || err || "");
  return /404|not found|NOT_FOUND|not supported/i.test(msg);
}

/**
 * Runs one task end-to-end and returns a full routing record.
 *
 * @param {object} task - entry from TASKS
 * @param {object} brief - { topic, niche, angle, language, durationSec }
 * @param {object} opts - { routingPreference, selectedHook, onDownloadProgress }
 * @returns {Promise<{taskId, data, rawText, parseOk, source, modelName, latencyMs, initMs, requestedMode, why, error?}>}
 */
export async function runTask(task, brief, opts = {}) {
  const routingPreference = opts.routingPreference || "auto";
  const mode = resolveMode(task, routingPreference);
  const language = brief.language === "id" ? "id" : "en";

  // Fallback chain for the cloud model: primary, then the alternate.
  const cloudModels =
    task.cloudModel === CLOUD_MODEL_STRONG
      ? [CLOUD_MODEL_STRONG, CLOUD_MODEL_FAST]
      : [CLOUD_MODEL_FAST, CLOUD_MODEL_STRONG];

  let lastError = null;
  for (let attempt = 0; attempt < cloudModels.length; attempt++) {
    const cloudModel = cloudModels[attempt];
    const model = getCachedModel(
      `${task.id}|${mode}|${cloudModel}|${language}`,
      () => buildModel(task, mode, cloudModel, language)
    );

    // The on-device model must be initialized after a user gesture and
    // before the first prompt. Generation is always click-triggered, so
    // this is safe here. Progress is surfaced to the UI.
    let initMs = 0;
    if (modeUsesOnDevice(mode) && !DEVICE_INIT_DONE.has(model)) {
      const initStart = performance.now();
      try {
        await model.initializeDeviceModel((progress) => {
          opts.onDownloadProgress?.(progress);
        });
        DEVICE_INIT_DONE.add(model);
      } catch (err) {
        // initializeDeviceModel failing means Nano can't start; in
        // PREFER_ON_DEVICE the generateContent call below will still fall
        // back to cloud, so we only record the failure and continue.
        console.warn("[creator-studio] Device model init failed:", err);
      }
      initMs = Math.round(performance.now() - initStart);
    }

    const prompt = task.buildPrompt(brief, {
      selectedHook: opts.selectedHook,
    });
    const started = performance.now();
    try {
      const result = await model.generateContent(prompt);
      const latencyMs = Math.round(performance.now() - started);
      const response = result.response;
      const source = response.inferenceSource || "IN_CLOUD";
      const { data, parseOk, rawText } = parseJsonOutput(response.text());

      const modelName =
        source === "ON_DEVICE" ? ON_DEVICE_MODEL_LABEL : cloudModel;
      const why =
        source === "ON_DEVICE"
          ? task.whyOnDevice
          : routingPreference === "cloud_only" || mode === InferenceMode.ONLY_IN_CLOUD
            ? task.whyCloudForced
            : task.whyCloud;

      return {
        taskId: task.id,
        data,
        rawText,
        parseOk,
        source,
        modelName,
        latencyMs,
        initMs,
        requestedMode: mode,
        why,
        usedFallbackModel: attempt > 0,
      };
    } catch (err) {
      lastError = err;
      // Retry once with the alternate cloud model if the named model 404s.
      if (modeUsesCloud(mode) && isModelNotFoundError(err) && attempt === 0) {
        console.warn(
          `[creator-studio] Cloud model ${cloudModel} unavailable, retrying with ${cloudModels[1]}:`,
          err
        );
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

/**
 * Checks the Chrome Prompt API directly (for the status pill only — routing
 * itself is decided by the Firebase SDK). Returns one of:
 * available | downloading | downloadable | unavailable | unsupported | unknown
 */
export async function checkNanoAvailability() {
  if (typeof window === "undefined" || !("LanguageModel" in window)) {
    return {
      status: "unsupported",
      detail:
        "This browser has no built-in Prompt API. On-device AI needs Chrome 139+ on desktop.",
    };
  }
  try {
    const status = await window.LanguageModel.availability();
    const details = {
      available: "Gemini Nano is downloaded and ready on this device.",
      downloading: "Gemini Nano is downloading in the background.",
      downloadable: "Gemini Nano can be downloaded on first use.",
      unavailable: "Gemini Nano is not available on this device.",
    };
    return { status, detail: details[status] || `Prompt API status: ${status}` };
  } catch (err) {
    return { status: "unknown", detail: `Could not check Nano: ${err.message}` };
  }
}

export function isFirebaseLive() {
  return isConfigured && Boolean(getFirebaseAI());
}
