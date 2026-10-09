import { test } from "node:test";
import assert from "node:assert/strict";
import { aclFilter, rrf, type Hit } from "../src/retrieval/search.js";

const hit = (id: string, via: Hit["via"] = "keyword"): Hit => ({
  chunk_id: id, doc_id: id.split("#")[0], title: "", source: "", heading_path: "", content: "", position: 0, score: 0, via,
});

test("RRF：兩路都排前面的會贏", () => {
  const kw = [hit("a#1"), hit("b#1"), hit("c#1")];
  const vec = [hit("b#1", "vector"), hit("d#1", "vector"), hit("a#1", "vector")];
  const out = rrf([kw, vec], 3);
  assert.equal(out[0].chunk_id, "b#1");
  assert.equal(out[0].via, "both");
  assert.ok(Math.abs(out[0].score - (1 / 62 + 1 / 61)) < 1e-9);
});

test("RRF：權重 0 等於只看另一路", () => {
  const kw = [hit("a#1"), hit("b#1")];
  const vec = [hit("b#1", "vector"), hit("a#1", "vector")];
  assert.equal(rrf([kw, vec], 2, 60, [0, 1])[0].chunk_id, "b#1");
});

test("RRF：取前 k 筆、不重複", () => {
  const out = rrf([[hit("a#1"), hit("b#1")], [hit("a#1", "vector"), hit("c#1", "vector")]], 5);
  assert.deepEqual(out.map((h) => h.chunk_id).sort(), ["a#1", "b#1", "c#1"]);
});

test("ACL filter 一定包含 public，濾掉非字串", () => {
  assert.deepEqual(aclFilter([]), { terms: { acl: ["public"] } });
  assert.deepEqual(aclFilter(["team", 3 as unknown as string, ""]), { terms: { acl: ["public", "team"] } });
});
