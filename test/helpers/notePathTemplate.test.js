const test = require("node:test");
const assert = require("node:assert/strict");

const { slugify, formatDate, buildFilename } = require("../../src/helpers/notePathTemplate");

test("slugify sanitizes illegal characters, spaces, and case", () => {
  assert.equal(slugify("My Meeting: Q3/Q4?"), "my-meeting--q3-q4-");
  assert.equal(slugify("  Trim  Me  "), "trim-me");
  assert.equal(slugify(""), "untitled");
  assert.equal(slugify(null), "untitled");
});

test("slugify caps length at 60 chars", () => {
  const long = "a".repeat(100);
  assert.equal(slugify(long).length, 60);
});

test("formatDate returns YYYY-MM-DD and empty on invalid input", () => {
  assert.equal(formatDate("2026-07-17T10:30:00.000Z").length, 10);
  assert.match(formatDate("2026-07-17T10:30:00.000Z"), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(formatDate(""), "");
  assert.equal(formatDate("not-a-date"), "");
});

test("id prefix reproduces the historical filename", () => {
  const note = { id: 42, title: "Weekly Sync", created_at: "2026-07-17T10:30:00Z" };
  assert.equal(buildFilename(note, { prefix: "id", type: "note" }), "42-weekly-sync.md");
  assert.equal(
    buildFilename(note, { prefix: "id", type: "transcript" }),
    "42-weekly-sync-transcript.md"
  );
});

test("date prefix uses the created date", () => {
  const note = { id: 42, title: "Weekly Sync", created_at: "2026-07-17T10:30:00Z" };
  assert.equal(buildFilename(note, { prefix: "date", type: "note" }), "2026-07-17-weekly-sync.md");
});

test("raw type gets a -raw discriminator", () => {
  const note = { id: 7, title: "Notes", created_at: "2026-07-17T10:30:00Z" };
  assert.equal(buildFilename(note, { prefix: "id", type: "raw" }), "7-notes-raw.md");
});

test("date prefix falls back to id when created_at is missing", () => {
  const note = { id: 99, title: "Orphan", created_at: null };
  assert.equal(buildFilename(note, { prefix: "date", type: "note" }), "99-orphan.md");
});

test("defaults: id prefix + note type", () => {
  const note = { id: 5, title: "Default" };
  assert.equal(buildFilename(note), "5-default.md");
});
