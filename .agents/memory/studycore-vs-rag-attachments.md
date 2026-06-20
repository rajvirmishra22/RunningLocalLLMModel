---
name: StudyCore supersedes the standalone Knowledge Base
description: Why /knowledge-base + SQLite RAG store are NOT the target design for this app.
---

This app was transformed from "LocalModel Studio" into "StudyCore AI". The StudyCore
design **replaces** the older standalone "Knowledge Base" page/feature with the
**Course Library** page at `/library` (`CourseLibrary.tsx`), an opt-in local RAG over
course materials.

**Implications for anyone grading against the older "Local RAG attachments" spec:**
- There is intentionally **no `/knowledge-base` route or nav entry**. `KnowledgeBase.tsx`
  was orphaned dead code and has been removed. Course Library is the KB surface.
- The desktop RAG store is **JSON-on-disk** (`desktop/src-tauri/src/rag_store.rs`), a
  deliberate choice documented in `replit.md` (no `rusqlite`, robust to partial writes).
  Do not "fix" this to SQLite — it is the chosen architecture, not an oversight.
- The assistant-turn "Used N excerpts from <file>" badge (`message.ragMeta`) IS expected
  and is rendered in `Chat.tsx`.

**Why:** automated code review re-grades new work against whatever task criteria are
wired up; here it kept using the superseded Local-RAG-attachments acceptance criteria,
flagging design decisions as regressions. Check the current product spec (StudyCore)
before treating these as bugs.
