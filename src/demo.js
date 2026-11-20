/**
 * Sample outputs used ONLY in demo mode (no Firebase config).
 * Every sample is rendered with a visible "SAMPLE" badge and the routing log
 * records "Demo mode — no inference ran", so sample output can never be
 * mistaken for live AI output.
 */

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const SAMPLE_BRIEF = {
  topic: "A leader who carried a sack of flour on his own back at night",
  niche: "Islamic stories",
  angle: "Story / parable",
  language: "en",
  durationSec: 30,
};

const SAMPLE_HOOKS = {
  hooks: [
    { text: "He was the most powerful man in the city — and he carried flour at midnight.", type: "curiosity" },
    { text: "Real leadership doesn't sit on a throne. It carries the heavy sack.", type: "contrast" },
    { text: "Would you recognize your leader if he knocked on your door at night?", type: "question" },
    { text: "One sack of flour changed how an entire city saw power.", type: "bold claim" },
    { text: "That night, a widow's children were crying — and a stranger arrived.", type: "story" },
  ],
};

const SAMPLE_CAPTION = {
  caption:
    "True leadership is measured by what you carry for others, not by what you own. Save this for the days leadership feels heavy.",
  hashtags: [
    "leadership",
    "islamicstories",
    "shorts",
    "motivation",
    "wisdom",
    "umar",
    "faith",
    "inspiration",
  ],
  callToAction: "Tag someone who leads by serving others.",
};

const SAMPLE_SCRIPT = {
  title: "The Leader Who Carried Flour at Night",
  hookLine: "He was the most powerful man in the city — and he carried flour at midnight.",
  scenes: [
    {
      scene: 1,
      visual: "Dark quiet street at night. A cloaked figure walks alone, a heavy sack on his back.",
      voiceover: "He was the most powerful man in the city — and he carried flour at midnight.",
      onscreenText: "Power looks like this?",
      durationSec: 5,
    },
    {
      scene: 2,
      visual: "Inside a small home, a mother stirs an empty pot while her children sleep hungry.",
      voiceover: "A widow had no food. Her children cried themselves to sleep.",
      onscreenText: "An empty pot",
      durationSec: 6,
    },
    {
      scene: 3,
      visual: "The leader kneels, lights a small fire, and cooks the flour himself, smoke on his beard.",
      voiceover: "So the leader came himself — and cooked with his own hands.",
      onscreenText: "He cooked it himself",
      durationSec: 8,
    },
    {
      scene: 4,
      visual: "The children eat and laugh. The leader watches from the doorway, smiling quietly.",
      voiceover: "He did not leave until the children laughed again.",
      onscreenText: "He stayed until they smiled",
      durationSec: 6,
    },
    {
      scene: 5,
      visual: "Sunrise over the city. The figure walks home, unrecognized.",
      voiceover: "Real leadership is what you carry for others — not what you own.",
      onscreenText: "Lead by serving",
      durationSec: 5,
    },
  ],
  closingLine: "Follow for one story like this every day.",
  totalDurationSec: 30,
};

const SAMPLE_TITLES = {
  titles: [
    "The Leader Who Carried Flour at Night",
    "Power Isn't a Throne — It's a Heavy Sack",
    "He Cooked for a Stranger's Children",
    "The Night a Ruler Became a Servant",
  ],
  thumbnailTexts: [
    "HE CARRIED IT HIMSELF",
    "LEADERSHIP = SERVICE",
    "MIDNIGHT FLOUR RUN",
    "THE HUMBLE RULER",
  ],
};

const SAMPLES = {
  hooks: SAMPLE_HOOKS,
  caption: SAMPLE_CAPTION,
  script: SAMPLE_SCRIPT,
  titles: SAMPLE_TITLES,
};

/**
 * Simulates a task run in demo mode. Returns the same record shape as the
 * real `runTask`, with source "DEMO" and an honest `why`.
 */
export async function runDemoTask(task, brief) {
  // Short delay so the UI's loading states are visible and testable.
  await sleep(500 + Math.random() * 600);
  const data = SAMPLES[task.id] || { _raw: "No sample for this task." };
  return {
    taskId: task.id,
    data,
    rawText: JSON.stringify(data, null, 2),
    parseOk: true,
    source: "DEMO",
    modelName: "Sample output",
    latencyMs: 0,
    initMs: 0,
    requestedMode: task.defaultMode,
    why: "Demo mode — connect Firebase to generate live with Gemini Nano + Gemini.",
    usedFallbackModel: false,
  };
}
