import type { assistant as deAssistant } from "../de/assistant";

/** F7 · Texte für KI-Assistent (AssistantPage), englisch. Eigener Chunk – lädt erst mit der Seite. */
export const assistant = {
  title: "Planning assistant",
  lead: "Describe in one sentence what you're up to – the assistant suggests places that fit.",
  disabled: {
    title: "The assistant isn't set up yet",
    body: "The interface is ready: the Edge Function “assistant” is in the project, but it needs an AI key as a server secret. Until that's there, the assistant stays off – it doesn't make up answers.",
    how: "Setup: see the README, section “KI-Assistent”.",
    alternative: "Until then, you can find places via Discover and its filters.",
    toDiscover: "Go to Discover",
  },
  inputLabel: "Your request",
  placeholder: "There are six of us and we want to do something tonight for at most €30 per person.",
  examples: ["Something active for 5 people, at most €20 per person", "Two hours indoors, ages 14 and up", "Bowling and then dinner"],
  submit: "Find suggestions",
  thinking: "The assistant is searching …",
  understood: "Here's how I understood you",
  missing: "I still need one more detail",
  suggestions: "Suggestions",
  noSuggestions: "There's no matching place in the available data for this request.",
  why: "Why",
  caveat: "Prices and opening hours come from the stored data and may differ. Availability isn't checked. The assistant doesn't book or pay for anything.",
  addToPoll: "Prepare a poll",
  unavailable: "The assistant can't be reached right now. Use Discover in the meantime.",
} satisfies typeof deAssistant;
