/**
 * Prompt builders and structured-output schemas for every Creator Studio task.
 *
 * The prompts encode real short-form craft: a hook in the first 3 seconds,
 * one sharp "wow" moment per video, on-screen text synced to the spoken
 * words, and a clear closing line. Schemas use the Firebase `Schema` helpers
 * so the same schema drives both the cloud model (via `responseSchema`) and
 * the on-device model (via `responseConstraint`).
 */
import { Schema } from "firebase/ai";

// ---------------------------------------------------------------------------
// Schemas (shared by cloud + on-device)
// ---------------------------------------------------------------------------

export const hooksSchema = Schema.object({
  properties: {
    hooks: Schema.array({
      items: Schema.object({
        properties: {
          text: Schema.string(),
          type: Schema.enumString({
            enum: ["curiosity", "contrast", "question", "bold claim", "story"],
          }),
        },
      }),
    }),
  },
});

export const captionSchema = Schema.object({
  properties: {
    caption: Schema.string(),
    hashtags: Schema.array({ items: Schema.string() }),
    callToAction: Schema.string(),
  },
});

export const scriptSchema = Schema.object({
  properties: {
    title: Schema.string(),
    hookLine: Schema.string(),
    scenes: Schema.array({
      items: Schema.object({
        properties: {
          scene: Schema.integer(),
          visual: Schema.string(),
          voiceover: Schema.string(),
          onscreenText: Schema.string(),
          durationSec: Schema.number(),
        },
      }),
    }),
    closingLine: Schema.string(),
    totalDurationSec: Schema.number(),
  },
});

export const titlesSchema = Schema.object({
  properties: {
    titles: Schema.array({ items: Schema.string() }),
    thumbnailTexts: Schema.array({ items: Schema.string() }),
  },
});

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

function languageLine(language) {
  return language === "id"
    ? "Write ALL output in Bahasa Indonesia (natural, casual, conversational — never stiff or formal)."
    : "Write ALL output in English (natural, casual, conversational — never stiff or formal).";
}

function briefLine(brief) {
  return [
    `Topic: ${brief.topic}`,
    `Niche: ${brief.niche}`,
    `Angle: ${brief.angle}`,
    `Target length: ${brief.durationSec} seconds`,
    `Platform: short-form vertical video (YouTube Shorts / Reels / TikTok)`,
  ].join("\n");
}

export function buildHooksPrompt(brief) {
  return [
    "You are a short-form video strategist. Write 5 opening hooks for a vertical short video.",
    "Rules: each hook is ONE spoken line, max 12 words, designed to stop the scroll in the first 3 seconds.",
    "Vary the hook types: curiosity, contrast, question, bold claim, story.",
    "Never use clickbait that the video cannot deliver.",
    languageLine(brief.language),
    "",
    briefLine(brief),
    "",
    "Return JSON matching the schema: { hooks: [{ text, type }] } with exactly 5 hooks.",
  ].join("\n");
}

export function buildCaptionPrompt(brief, selectedHook) {
  return [
    "You are a short-form video strategist. Write a caption and hashtags for a vertical short video.",
    "Rules: caption is 1–2 short sentences, warm and human, no emojis spam, no generic filler.",
    "Hashtags: 6–10, a mix of broad and niche, all lowercase, no spaces.",
    "Call to action: one short line inviting a comment or a save.",
    languageLine(brief.language),
    "",
    briefLine(brief),
    selectedHook ? `Opening hook used in the video: "${selectedHook}"` : "",
    "",
    "Return JSON matching the schema: { caption, hashtags, callToAction }.",
  ].join("\n");
}

export function buildScriptPrompt(brief, selectedHook) {
  return [
    "You are a short-form video scriptwriter. Write a complete script for a vertical short video.",
    `Rules: exactly 5 scenes, total duration about ${brief.durationSec} seconds.`,
    "Scene 1 must deliver the hook in the first 3 seconds. Include ONE sharp, memorable moment (a surprising fact, a twist, or a vivid image) in scene 3 or 4.",
    "The voiceover is narration — the on-screen character never speaks to camera.",
    "On-screen text must match the words being spoken at that moment, max 6 words per scene, placed in the lower third.",
    "Never invent quotes, scriptures, or historical facts. If the topic involves a real story, keep it to well-known, verifiable points.",
    languageLine(brief.language),
    "",
    briefLine(brief),
    selectedHook ? `Opening hook to use in scene 1: "${selectedHook}"` : "",
    "",
    "Return JSON matching the schema: { title, hookLine, scenes: [{ scene, visual, voiceover, onscreenText, durationSec }], closingLine, totalDurationSec }.",
  ].join("\n");
}

export function buildTitlesPrompt(brief) {
  return [
    "You are a short-form video strategist. Write title and thumbnail-text options for a vertical short video.",
    "Rules: 4 titles, each under 60 characters, keyword-first, specific — never vague.",
    "4 thumbnail texts, each 2–5 words, high contrast wording, no repeating the title verbatim.",
    languageLine(brief.language),
    "",
    briefLine(brief),
    "",
    "Return JSON matching the schema: { titles, thumbnailTexts } with exactly 4 of each.",
  ].join("\n");
}

// System prompt used for the on-device model (via onDeviceParams.createOptions
// initialPrompts). Kept short: on-device models do best with tight instructions.
export const ON_DEVICE_SYSTEM_PROMPT =
  "You are a concise short-form video strategist. Answer only with the requested JSON, no extra text.";
