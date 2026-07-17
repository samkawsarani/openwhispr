const fs = require("fs");
const path = require("path");
const debugLogger = require("./debugLogger");
const { slugify, buildFilename } = require("./notePathTemplate");

const INDEX_FILE = ".openwhispr-mirror-index.json";

// Default export config — chosen to reproduce the historical behavior exactly
// (enhanced note + transcript, `<id>-<slug>` names, in-app folder dirs).
const DEFAULT_CONFIG = {
  content: ["enhanced", "transcript"],
  filenamePrefix: "id",
  structure: "folder",
};

// A transcript file always ends with `-transcript.md` (the type suffix is
// appended before the extension), regardless of prefix — so we can categorize
// index entries by name without extra bookkeeping.
function isTranscriptPath(p) {
  return p.endsWith("-transcript.md") || p.endsWith("-transcript.txt");
}

class MarkdownMirror {
  constructor() {
    this._basePath = null;
    this._config = { ...DEFAULT_CONFIG };
    // noteId -> [absolute file paths] written for that note. Persisted to disk
    // so stale-file cleanup survives across custom filename prefixes and
    // date-based folders (the old `<id>-` glob can't find those).
    this._index = {};
  }

  init(basePath) {
    this._basePath = basePath;
    try {
      fs.mkdirSync(basePath, { recursive: true });
      this._loadIndex();
      debugLogger.debug("Markdown mirror initialized", { basePath }, "note-files");
    } catch (err) {
      debugLogger.error("Failed to init markdown mirror", { error: err.message }, "note-files");
    }
  }

  setConfig(partial) {
    if (!partial || typeof partial !== "object") return;
    const next = { ...this._config };
    if (Array.isArray(partial.content)) {
      next.content = partial.content.filter((c) => ["enhanced", "raw", "transcript"].includes(c));
    }
    if (partial.filenamePrefix === "id" || partial.filenamePrefix === "date") {
      next.filenamePrefix = partial.filenamePrefix;
    }
    if (partial.structure === "folder" || partial.structure === "date") {
      next.structure = partial.structure;
    }
    this._config = next;
    debugLogger.debug("Markdown mirror config set", { config: next }, "note-files");
  }

  getBasePath() {
    return this._basePath;
  }

  // Kept for backward compatibility; delegates to the shared slug rules.
  _slugify(title) {
    return slugify(title);
  }

  _buildFrontmatter(note, folderName) {
    const escYaml = (str) => {
      if (!str) return '""';
      if (/[:#{}[\],&*?|>!%@`]/.test(str) || str.includes('"') || str.includes("'")) {
        return `"${str.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
      }
      return str;
    };
    const lines = [
      "---",
      `id: ${note.id}`,
      `title: ${escYaml(note.title)}`,
      `type: ${note.note_type || "personal"}`,
      `folder: ${escYaml(folderName || "Personal")}`,
      `created: ${note.created_at || new Date().toISOString()}`,
      `updated: ${note.updated_at || new Date().toISOString()}`,
      "---",
    ];
    return lines.join("\n");
  }

  // Destination directory for a note's files, honoring the structure setting.
  // `folder` -> `<base>/<in-app folder name>`; `date` -> `<base>/YYYY/MM` from
  // the note's created date (falls back to "undated" if it can't be parsed).
  _noteDir(note, folderName) {
    if (this._config.structure === "date") {
      const d = new Date(note.created_at || Date.now());
      if (!Number.isNaN(d.getTime())) {
        const y = String(d.getFullYear());
        const m = String(d.getMonth() + 1).padStart(2, "0");
        return path.join(this._basePath, y, m);
      }
      return path.join(this._basePath, "undated");
    }
    return path.join(this._basePath, folderName || "Personal");
  }

  // Ensure the target path doesn't collide with a *different* note's file
  // (possible once the id is no longer the filename prefix). Appends `-<id>`.
  _uniquePath(dirPath, filename, noteId) {
    let candidate = path.join(dirPath, filename);
    const owner = this._pathOwner(candidate);
    if (owner != null && owner !== noteId) {
      const base = filename.replace(/\.md$/, "");
      candidate = path.join(dirPath, `${base}-${noteId}.md`);
      debugLogger.debug(
        "Mirror filename collision, disambiguated with id",
        { noteId, filename },
        "note-files"
      );
    }
    return candidate;
  }

  _pathOwner(absPath) {
    for (const [id, paths] of Object.entries(this._index)) {
      if (paths.includes(absPath)) return Number(id);
    }
    return null;
  }

  // Reconcile one category (note files vs transcript) of a note's outputs:
  // delete indexed-but-no-longer-desired files, write the desired ones, and
  // update the persisted index without disturbing the other category.
  _reconcile(noteId, categoryMatch, desired) {
    const current = this._index[noteId] || [];
    const desiredPaths = desired.map((d) => d.path);
    for (const existing of current) {
      if (categoryMatch(existing) && !desiredPaths.includes(existing)) {
        try {
          fs.unlinkSync(existing);
        } catch {}
      }
    }
    for (const d of desired) {
      fs.writeFileSync(d.path, d.contents, "utf-8");
    }
    const kept = current.filter((p) => !categoryMatch(p));
    this._index[noteId] = [...kept, ...desiredPaths];
    this._saveIndex();
  }

  writeNote(note, folderName) {
    if (!this._basePath) return;
    try {
      const content = this._config.content;
      const writeEnhanced = content.includes("enhanced");
      const writeRaw = content.includes("raw");
      const dirPath = this._noteDir(note, folderName);
      const frontmatter = this._buildFrontmatter(note, folderName || "Personal");

      const desired = [];
      if (writeEnhanced || writeRaw) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
      if (writeEnhanced) {
        const filename = buildFilename(note, {
          prefix: this._config.filenamePrefix,
          type: "note",
        });
        const body = note.enhanced_content || note.content || "";
        desired.push({
          path: this._uniquePath(dirPath, filename, note.id),
          contents: `${frontmatter}\n\n${body}`,
        });
      }
      if (writeRaw) {
        // If both enhanced and raw are exported, the raw file needs a distinct
        // name; if raw is the only note export, it takes the plain note name.
        const filename = buildFilename(note, {
          prefix: this._config.filenamePrefix,
          type: writeEnhanced ? "raw" : "note",
        });
        const body = note.content || "";
        desired.push({
          path: this._uniquePath(dirPath, filename, note.id),
          contents: `${frontmatter}\n\n${body}`,
        });
      }

      this._reconcile(note.id, (p) => !isTranscriptPath(p), desired);
    } catch (err) {
      debugLogger.error(
        "Failed to write note file",
        { noteId: note.id, error: err.message },
        "note-files"
      );
    }
  }

  writeTranscript(note, folderName, speakerMappings) {
    if (!this._basePath) return;
    try {
      const wantTranscript = this._config.content.includes("transcript");
      let desired = [];
      if (wantTranscript) {
        const segments = JSON.parse(note.transcript || "[]");
        if (segments.length) {
          const dirPath = this._noteDir(note, folderName);
          fs.mkdirSync(dirPath, { recursive: true });
          const filename = buildFilename(note, {
            prefix: this._config.filenamePrefix,
            type: "transcript",
          });
          const { formatMd } = require("./transcriptFormatter");
          desired = [
            {
              path: this._uniquePath(dirPath, filename, note.id),
              contents: formatMd(note, segments, speakerMappings || {}),
            },
          ];
        }
      }
      this._reconcile(note.id, (p) => isTranscriptPath(p), desired);
    } catch (err) {
      debugLogger.error(
        "Failed to write transcript file",
        { noteId: note.id, error: err.message },
        "note-files"
      );
    }
  }

  deleteNote(noteId) {
    if (!this._basePath) return;
    try {
      const indexed = this._index[noteId] || [];
      const legacy = [...this._globNoteFiles(noteId), ...this._globTranscriptFiles(noteId)];
      for (const f of new Set([...indexed, ...legacy])) {
        try {
          fs.unlinkSync(f);
        } catch {}
      }
      delete this._index[noteId];
      this._saveIndex();
    } catch (err) {
      debugLogger.error("Failed to delete note file", { noteId, error: err.message }, "note-files");
    }
  }

  ensureFolder(folderName) {
    if (!this._basePath) return;
    // Folders only exist on disk in "folder" structure mode.
    if (this._config.structure !== "folder") return;
    try {
      fs.mkdirSync(path.join(this._basePath, folderName), { recursive: true });
    } catch (err) {
      debugLogger.error(
        "Failed to ensure folder",
        { folderName, error: err.message },
        "note-files"
      );
    }
  }

  renameFolder(oldName, newName) {
    if (!this._basePath) return;
    // In date mode files aren't laid out by folder; a Rebuild refreshes the
    // frontmatter `folder:` field. Nothing to move on disk.
    if (this._config.structure !== "folder") return;
    try {
      const oldPath = path.join(this._basePath, oldName);
      const newPath = path.join(this._basePath, newName);
      if (fs.existsSync(oldPath)) {
        fs.renameSync(oldPath, newPath);
        this._reindexAfterFolderRename(oldPath, newPath);
      }
    } catch (err) {
      debugLogger.error(
        "Failed to rename folder",
        { oldName, newName, error: err.message },
        "note-files"
      );
    }
  }

  deleteFolder(folderName, noteIds) {
    if (!this._basePath) return;
    try {
      if (this._config.structure === "folder") {
        const dir = path.join(this._basePath, folderName);
        if (fs.existsSync(dir)) {
          fs.rmSync(dir, { recursive: true, force: true });
        }
        this._forgetUnder(dir);
      } else {
        // Date mode: files live in date dirs, so delete each note's files.
        for (const noteId of noteIds || []) {
          this.deleteNote(noteId);
        }
      }
      this._saveIndex();
    } catch (err) {
      debugLogger.error(
        "Failed to delete folder",
        { folderName, error: err.message },
        "note-files"
      );
    }
  }

  rebuildAll(notes, folderMap, speakerMappingsMap) {
    if (!this._basePath) return;
    try {
      // Clear every previously written file (index + legacy glob) so a rebuild
      // never leaves orphans behind when the naming/structure changes.
      for (const paths of Object.values(this._index)) {
        for (const p of paths) {
          try {
            fs.unlinkSync(p);
          } catch {}
        }
      }
      for (const note of notes) {
        for (const p of [...this._globNoteFiles(note.id), ...this._globTranscriptFiles(note.id)]) {
          try {
            fs.unlinkSync(p);
          } catch {}
        }
      }
      this._index = {};
      this._saveIndex();

      for (const note of notes) {
        const folderName = folderMap[note.folder_id] || "Personal";
        this.writeNote(note, folderName);
        if (note.transcript) {
          this.writeTranscript(note, folderName, speakerMappingsMap?.[note.id] || {});
        }
      }
      debugLogger.info("Markdown mirror rebuild complete", { count: notes.length }, "note-files");
    } catch (err) {
      debugLogger.error("Failed to rebuild all note files", { error: err.message }, "note-files");
    }
  }

  getNotePath(noteId) {
    if (!this._basePath) return null;
    const indexed = (this._index[noteId] || []).filter((p) => !isTranscriptPath(p));
    if (indexed.length) return indexed[0];
    const files = this._globNoteFiles(noteId);
    return files.length > 0 ? files[0] : null;
  }

  getFolderPath(folderName) {
    if (!this._basePath) return null;
    const dirPath = path.join(this._basePath, folderName);
    return fs.existsSync(dirPath) ? dirPath : null;
  }

  _loadIndex() {
    this._index = {};
    try {
      const file = path.join(this._basePath, INDEX_FILE);
      if (fs.existsSync(file)) {
        const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
        if (raw && typeof raw === "object") this._index = raw;
      }
    } catch (err) {
      debugLogger.error("Failed to load mirror index", { error: err.message }, "note-files");
      this._index = {};
    }
  }

  _saveIndex() {
    if (!this._basePath) return;
    try {
      const file = path.join(this._basePath, INDEX_FILE);
      fs.writeFileSync(file, JSON.stringify(this._index), "utf-8");
    } catch (err) {
      debugLogger.error("Failed to save mirror index", { error: err.message }, "note-files");
    }
  }

  _forgetUnder(dir) {
    const prefix = dir.endsWith(path.sep) ? dir : dir + path.sep;
    for (const [id, paths] of Object.entries(this._index)) {
      const kept = paths.filter((p) => !p.startsWith(prefix));
      if (kept.length) this._index[id] = kept;
      else delete this._index[id];
    }
  }

  _reindexAfterFolderRename(oldPath, newPath) {
    const prefix = oldPath.endsWith(path.sep) ? oldPath : oldPath + path.sep;
    for (const [id, paths] of Object.entries(this._index)) {
      this._index[id] = paths.map((p) =>
        p.startsWith(prefix) ? newPath + p.slice(oldPath.length) : p
      );
    }
    this._saveIndex();
  }

  _globNoteFiles(noteId) {
    if (!this._basePath) return [];
    const results = [];
    try {
      const prefix = `${noteId}-`;
      const dirs = fs.readdirSync(this._basePath, { withFileTypes: true });
      for (const dir of dirs) {
        if (!dir.isDirectory()) continue;
        const dirPath = path.join(this._basePath, dir.name);
        const files = fs.readdirSync(dirPath);
        for (const file of files) {
          if (file.startsWith(prefix) && file.endsWith(".md")) {
            results.push(path.join(dirPath, file));
          }
        }
      }
    } catch {}
    return results;
  }

  _globTranscriptFiles(noteId) {
    if (!this._basePath) return [];
    const results = [];
    try {
      const prefix = `${noteId}-`;
      const dirs = fs.readdirSync(this._basePath, { withFileTypes: true });
      for (const dir of dirs) {
        if (!dir.isDirectory()) continue;
        const dirPath = path.join(this._basePath, dir.name);
        const files = fs.readdirSync(dirPath);
        for (const file of files) {
          if (
            file.startsWith(prefix) &&
            (file.endsWith("-transcript.md") || file.endsWith("-transcript.txt"))
          ) {
            results.push(path.join(dirPath, file));
          }
        }
      }
    } catch {}
    return results;
  }
}

module.exports = new MarkdownMirror();
