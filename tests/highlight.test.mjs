import assert from "node:assert/strict";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The helper is plain JavaScript in a .ts file so Pi reloads it through jiti.
// Import its source for dependency-free checks on Node versions without TS support.
const helperSource = await readFile(new URL("../highlight.ts", import.meta.url), "utf8");
const { highlightGoal } = await import(`data:text/javascript;base64,${Buffer.from(helperSource).toString("base64")}`);

// Core contract checks need no dependencies. Host integration uses the actual installed Pi.
const plainUtils = {
  visibleWidth: value => Array.from(value).length,
  wrapTextWithAnsi: (value, width) => {
    const chars = Array.from(value);
    return chars.length ? Array.from({ length: Math.ceil(chars.length / width) }, (_, i) => chars.slice(i * width, (i + 1) * width).join("")) : [""];
  },
};
const context = { messageType: "user", availableWidth: 80, isStreaming: false };
const prompt = body => `Goal mode is active. Complete this goal fully:\n\n<goal_objective>\n${body}\n</goal_objective>\n\n<goal_id>\nunchanged-id\n</goal_id>\nRules and continuation markers stay intact.`;
const stripAnsi = value => value.replace(/\x1b\[[0-9;]*m/g, "");

test("presentation replaces the generated introduction and XML wrapper with GOAL", () => {
  const original = prompt("Execute integralmente o plano.");
  const output = highlightGoal(original, context, plainUtils);
  assert.ok(output.includes("\x1b[48;2;32;48;59m"));
  assert.ok(output.includes("\x1b[38;2;110;231;220m"));
  assert.ok(stripAnsi(output).startsWith("[GOAL]"));
  assert.ok(!output.includes("<goal_objective>"));
  assert.ok(!output.includes("</goal_objective>"));
  assert.ok(!output.includes("```"));
  assert.ok(!output.includes("Goal mode is active."));
  assert.ok(output.endsWith("<goal_id>\nunchanged-id\n</goal_id>\nRules and continuation markers stay intact."));
  assert.equal(original, prompt("Execute integralmente o plano."));
  assert.equal(highlightGoal(output, context, plainUtils), output);
});

test("ordinary, assistant, quoted and incomplete messages pass through", () => {
  for (const message of ["Olá", "Exemplo:\n<goal_objective>\nteste\n</goal_objective>", "Goal mode is active. Complete this goal fully:\n<goal_objective>\nincomplete"]) {
    assert.equal(highlightGoal(message, context, plainUtils), message);
  }
  const message = prompt("body");
  assert.equal(highlightGoal(message, { ...context, messageType: "assistant" }, plainUtils), message);
});

test("all upstream visible goal prompt variants are recognized", () => {
  for (const prefix of ["The active /goal objective was updated.", "The user explicitly resumed the paused /goal.", "The active /goal was waiting for an external event, and the user explicitly resumed it.", "Continue the active /goal until it is complete:"]) {
    const message = `${prefix}\n\n<goal_objective>\nbody\n</goal_objective>`;
    assert.ok(highlightGoal(message, context, plainUtils).includes("\x1b[48;2;32;48;59m"));
  }
});

test("user-authored Markdown is retained without adding an extension code fence", () => {
  const output = highlightGoal(prompt("**Literal** &lt;xml&gt;\n````typescript\nconst x = 1;\n````"), context, plainUtils);
  assert.ok(!output.includes("`````goal"));
  assert.ok(stripAnsi(output).includes("**Literal** <xml>"));
  assert.ok(stripAnsi(output).includes("const x = 1;"));
});

test("user terminal controls cannot survive inside the colored area", () => {
  const output = highlightGoal(prompt("safe\x1b]52;clipboard\x07\x00end"), context, plainUtils);
  assert.ok(!stripAnsi(output).includes("\x1b"));
  assert.ok(!output.includes("\x07"));
  assert.ok(!output.includes("\x00"));
});

test("actual Pi renderer keeps colors, wraps Unicode and respects terminal resize", { skip: !process.env.PI_TEST_PACKAGE }, async () => {
  const root = process.env.PI_TEST_PACKAGE.replace(/\\/g, "/");
  const host = await import(pathToFileURL(`${root}/dist/index.js`).href);
  const tui = await import(pathToFileURL(`${root}/node_modules/@earendil-works/pi-tui/dist/index.js`).href);
  host.initTheme("dark", false);
  const original = prompt("Ação 日本語 🧪 **literal** `code` &lt;task&gt;\n" + "Texto longo para verificar quebra de linha e redimensionamento. ".repeat(8));
  const transform = (text, ctx) => highlightGoal(text, ctx, tui);
  const component = new host.UserMessageComponent(original, host.getMarkdownTheme(), 1, [transform]);
  for (const width of [120, 80, 30, 10]) {
    const lines = component.render(width);
    assert.ok(lines.every(line => tui.visibleWidth(line) <= width), `render exceeded ${width} columns`);
    assert.ok(lines.some(line => line.includes("\x1b[48;2;32;48;59m")));
    const visible = lines.map(stripAnsi).join("\n");
    assert.ok(!visible.includes("goal_objective"));
    assert.ok(!visible.includes("```goal"));
    assert.ok(visible.includes("[GOAL]"));
    if (width >= 80) assert.ok(visible.includes("literal") && visible.includes("code") && visible.includes("<task>"));
  }
  assert.equal(component.text, original, "stored user message must remain unchanged");
});

test("actual Pi extension loader registers only presentation and a preview command", { skip: !process.env.PI_TEST_PACKAGE }, async () => {
  const root = process.env.PI_TEST_PACKAGE.replace(/\\/g, "/");
  const loader = await import(pathToFileURL(`${root}/dist/core/extensions/loader.js`).href);
  const extensionPath = new URL("../index.ts", import.meta.url);
  const { fileURLToPath } = await import("node:url");
  const loaded = await loader.loadExtensions([fileURLToPath(extensionPath)], process.cwd());
  assert.deepEqual(loaded.errors, []);
  assert.equal(loaded.extensions.length, 1);
  const extension = loaded.extensions[0];
  assert.equal(extension.tools.size, 0);
  assert.equal(extension.handlers.size, 0, "no goal, context or prompt hook may be registered");
  assert.ok(extension.commands.has("goal-highlight-preview"));
  assert.ok(!extension.commands.has("goal"));
  assert.equal(typeof extension.markdownTransformer, "function");
  let closed = false;
  const command = extension.commands.get("goal-highlight-preview");
  await command.handler("", { hasUI: true, ui: {
    custom: async factory => {
      const preview = factory({}, {}, {}, () => { closed = true; });
      const lines = preview.render(80);
      assert.ok(lines.some(line => line.includes("\x1b[48;2;32;48;59m")));
      const visible = lines.map(stripAnsi).join("\n");
      assert.ok(visible.includes("[GOAL]"));
      assert.ok(!visible.includes("goal_objective"));
      assert.ok(!visible.includes("```"));
      preview.invalidate();
      preview.handleInput("\r");
    },
  } });
  assert.ok(closed, "the actual preview closes on Enter without sending a prompt");
});

test("Pi reload refreshes the helper and preview through the installed wrapper layout", { skip: !process.env.PI_TEST_PACKAGE }, async () => {
  const root = process.env.PI_TEST_PACKAGE.replace(/\\/g, "/");
  const loader = await import(pathToFileURL(`${root}/dist/core/extensions/loader.js`).href);
  const fixture = await mkdtemp(join(tmpdir(), "pi-goal-highlight-reload-"));
  const entry = await readFile(new URL("../index.ts", import.meta.url), "utf8");
  await writeFile(join(fixture, "index.ts"), entry);
  await writeFile(join(fixture, "wrapper.ts"), 'export { default } from "./index.ts";\n');
  await writeFile(join(fixture, "highlight.ts"), helperSource.replace('"[GOAL]"', '"[OLD]"'));
  const preview = async () => {
    const result = await loader.loadExtensions([join(fixture, "wrapper.ts")], fixture);
    assert.deepEqual(result.errors, []);
    let visible;
    await result.extensions[0].commands.get("goal-highlight-preview").handler("", { hasUI: true, ui: {
      custom: async factory => { visible = factory({}, {}, {}, () => {}).render(80).map(stripAnsi).join("\n"); },
    } });
    return visible;
  };
  assert.ok((await preview()).includes("[OLD]"));
  await writeFile(join(fixture, "highlight.ts"), helperSource);
  loader.clearExtensionCache();
  const visible = await preview();
  assert.ok(visible.includes("[GOAL]"));
  assert.ok(!visible.includes("[OLD]"));
  assert.ok(!visible.includes("goal_objective"));
  assert.ok(!visible.includes("```"));
});
