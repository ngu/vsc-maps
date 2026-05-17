import test from "node:test";
import assert from "node:assert/strict";
import * as yaml from "js-yaml";
import { applyReplacementToRawText } from "./documentEdits";

test("applyReplacementToRawText replaces view.center", () => {
  const rawText = [
    "view:",
    "  center: [0, 0]",
    "  zoom: 2",
    "layers:",
    "  - type: tile",
    "    source:",
    "      type: osm"
  ].join("\n");

  const nextText = applyReplacementToRawText(rawText, "view.center", [100, 100]);
  const parsed = yaml.load(nextText) as {
    view: { center: [number, number] };
  };

  assert.deepEqual(parsed.view.center, [100, 100]);
});
