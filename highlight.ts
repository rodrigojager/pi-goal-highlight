const GOAL_PROMPT = /^(?:Goal mode is active\. Complete this goal fully:|The active \/goal objective was updated\.|The user explicitly resumed |The active \/goal was waiting for an external event,|Continue the active \/goal until it is complete:)/;
const OBJECTIVE = /(?:^|\n)<goal_objective>\r?\n([\s\S]*?)\r?\n<\/goal_objective>(?=\r?\n|$)/;
const COLOR = "\x1b[48;2;41;33;61m\x1b[38;2;110;231;220m";
// Pi owns the row background, including margins. Reset only foreground here:
// a background reset would clear the purple before Pi paints the right padding.
const RESET = "\x1b[39m";

// Keep this module as .ts: Pi's jiti loader reloads it; native .mjs imports stay cached.
/** Presentation only: Pi calls this on a copy, immediately before Markdown rendering. */
export function highlightGoal(markdown, context, { wrapTextWithAnsi, visibleWidth }) {
  if (context.messageType !== "user" || !GOAL_PROMPT.test(markdown)) return markdown;
  // Do not interpret arbitrary user examples or already transformed text as goal messages.
  const match = OBJECTIVE.exec(markdown);
  if (!match) return markdown;
  const width = Math.max(1, Math.floor(context.availableWidth));
  // Undo exactly one layer of pi-goal's XML escaping for presentation only.
  // The generated preamble and XML wrapper are replaced by the visible label.
  const objective = match[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  const clean = objective.replace(/\r\n/g, "\n").replace(/\t/g, "   ").replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "");
  const lines = ["[GOAL]", ...clean.split("\n")].flatMap(line => wrapTextWithAnsi(line, width));
  const painted = lines.map(line => COLOR + line + " ".repeat(Math.max(0, width - visibleWidth(line))) + RESET).join("\n");
  // Show only the objective. IDs, rules and continuation markers remain in
  // the original message for the model and session, never in the transcript.
  return painted;
}
