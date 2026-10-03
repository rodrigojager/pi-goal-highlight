import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme, UserMessageComponent } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { highlightGoal } from "./highlight.ts";

export default function goalHighlight(pi: ExtensionAPI) {
  if (typeof pi.registerMarkdownTransformer !== "function") {
    throw new Error("pi-goal-highlight requires Pi 1.0.0 or newer (registerMarkdownTransformer).");
  }
  const transform = (markdown: string, context: { messageType: string; availableWidth: number }) =>
    highlightGoal(markdown, context, { visibleWidth, wrapTextWithAnsi });
  pi.registerMarkdownTransformer(transform);
  pi.registerCommand("goal-highlight-preview", {
    description: "Preview goal highlighting without starting a goal or a model request",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) return;
      const sample = "Goal mode is active. Complete this goal fully:\n\n<goal_objective>\nExemplo de objetivo: implementar, compilar e verificar o software.\nO bloco usa fundo roxo uniforme e texto turquesa, com quebra de linha.\n</goal_objective>\n\n<goal_id>\npreview-only\n</goal_id>\n\nPressione Enter ou Esc para fechar.";
      await ctx.ui.custom((_tui, _theme, _keys, done) => {
        const component = new UserMessageComponent(sample, getMarkdownTheme(), 1, [transform]);
        return {
          render: (width: number) => component.render(width),
          invalidate: () => component.invalidate(),
          handleInput: (data: string) => { if (matchesKey(data, Key.enter) || matchesKey(data, Key.escape)) done(undefined); },
        };
      });
    },
  });
}
