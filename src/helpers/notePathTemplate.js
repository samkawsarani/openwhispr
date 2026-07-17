// Builds on-disk filenames for the markdown mirror (note export).
//
// A filename is always `<prefix>-<slug><suffix>.md`, where:
//   - prefix is either the note id ("id") or the note's created date ("date",
//     formatted YYYY-MM-DD),
//   - slug is the sanitized note title (never the raw title),
//   - suffix distinguishes the artifact type ("" for the note, "-raw" for a raw
//     note written alongside an enhanced one, "-transcript" for the transcript).
//
// The default prefix ("id") reproduces the historical `<id>-<slug>.md` /
// `<id>-<slug>-transcript.md` names byte-for-byte.

// Sanitize a title into a filesystem-safe slug. Single source of truth — the
// markdown mirror imports this so slug rules never drift.
function slugify(title) {
  return (title || "Untitled")
    .replace(/[/\\?%*:|"<>]/g, "-")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase()
    .slice(0, 60);
}

// Format an ISO/date string as YYYY-MM-DD (local date parts, matching how the
// created_at timestamp is displayed elsewhere). Returns "" on an invalid date.
function formatDate(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const TYPE_SUFFIX = {
  note: "",
  raw: "-raw",
  transcript: "-transcript",
};

// Build the filename (no directory) for a note artifact.
//   note   - note row (needs id, title, created_at)
//   prefix - "id" | "date" (default "id")
//   type   - "note" | "raw" | "transcript" (default "note")
function buildFilename(note, { prefix = "id", type = "note" } = {}) {
  const slug = slugify(note.title);
  const suffix = TYPE_SUFFIX[type] ?? "";
  let head;
  if (prefix === "date") {
    // Fall back to the id when the date is unavailable so the name is never
    // just "-<slug>" (which would collide across dateless notes).
    head = formatDate(note.created_at) || String(note.id);
  } else {
    head = String(note.id);
  }
  return `${head}-${slug}${suffix}.md`;
}

module.exports = { slugify, formatDate, buildFilename, TYPE_SUFFIX };
