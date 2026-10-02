const GOAL_PROMPT = /^(?:Goal mode is active\. Complete this goal fully:|The active \/goal objective was updated\.|The user explicitly resumed |The active \/goal was waiting for an external event,|Continue the active \/goal until it is complete:)/;
const OBJECTIVE = /(^|\n)(<goal_objective>\r?\n[\s\S]*?\r?\n<\/goal_objective>)(?=\r?\n|$)/;
const COLOR = "\x1b[48;2;32;48;59m\x1b[38;2;110;231;220m";
const RESET = "\x1b[39m\x1b[49m";

/** Presentation only: Pi calls this on a copy, immediately before Markdown rendering. */
export function highlightGoal(markdown, context, { wrapTextWithAnsi, visibleWidth }) {
  if (context.messageType !== "user" || !GOAL_PROMPT.test(markdown)) return markdown;
  // Do not interpret arbitrary user examples or already transformed code as goal messages.
  if (!OBJECTIVE.test(markdown)) return markdown;
  const width = Math.max(1, Math.floor(context.availableWidth) - 2);
  return markdown.replace(OBJECTIVE, (_match, separator, objective) => {
    // Keep tags, XML entities, Markdown and literal code exactly as visible task data.
    // User-authored terminal controls must not escape the presentation block.
    const clean = objective.replace(/\r\n/g, "\n").replace(/\t/g, "   ").replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "");
    const runs = clean.match(/`+/g) ?? [];
    const fence = "`".repeat(runs.reduce((longest, run) => Math.max(longest, run.length + 1), 3));
    const lines = clean.split("\n").flatMap(line => wrapTextWithAnsi(line, width));
    const painted = lines.map(line => COLOR + line + " ".repeat(Math.max(0, width - visibleWidth(line))) + RESET).join("\n");
    return `${separator}\n${fence}goal\n${painted}\n${fence}\n`;
  });
}
