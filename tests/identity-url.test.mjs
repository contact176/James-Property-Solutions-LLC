import test from "node:test";
import assert from "node:assert/strict";
import { normalizeUrlForCompare } from "../scripts/url-utils.mjs";

test("redirect comparison removes query and fragment values", () => {
  const url = "https://access.example/cdn-cgi/access/login/site?kid=key&meta=signed-token#fragment";
  assert.equal(
    normalizeUrlForCompare(url),
    "https://access.example/cdn-cgi/access/login/site/",
  );
  assert.ok(!normalizeUrlForCompare(url).includes("signed-token"));
});

test("redirect comparison safely handles empty and malformed values", () => {
  assert.equal(normalizeUrlForCompare(null), null);
  assert.equal(normalizeUrlForCompare("not a url?secret=value"), "not a url");
});
