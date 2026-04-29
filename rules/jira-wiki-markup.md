# Jira Wiki Markup — Rule Set
**Target**: jira.pila.vn (Jira Server/DC, Wiki Style Renderer)
**Version**: 1.0.0  |  **Verified**: FIIN-23

---

## CR — Common Rules
*Apply to ALL Jira descriptions, no exceptions.*

### CR-01: Wiki Markup syntax only — never Markdown, never HTML
Correct → Wrong: *bold* → **bold**, _italic_ → *italic*, {{mono}} → `backtick`,
h3. Heading → ### Heading, [text|url] → [text](url), {code:sql} → ```sql```

### CR-02: {panel} for ALL colored blocks
{info}/{note}/{warning}/{tip} DO NOT RENDER on jira.pila.vn (show as literal text).
Use {panel:title=TITLE|borderColor=HEX|titleBGColor=HEX|bgColor=#ffffff} only.

Standard colors (bgColor always #ffffff):
| Purpose | borderColor | titleBGColor |
|---------|-------------|--------------|
| User Story / Business Rules / Role Tasks | #0052cc | #deebff |
| Acceptance Criteria | #00875a | #e3fcef |
| Technical Summary / Precondition / Errors | #ff8b00 | #fff0b3 |
| Technical Quick Reference | #ff991f | #fffae6 |
| References / Chains / INVEST | #6b778c | #f4f5f7 |
| TDD Contract | #403294 | #eae6ff |

### CR-03: Table syntax — only inside {panel}
Header row: || Col1 || Col2 ||  (double pipe)
Data row:   | Val1  | Val2  |   (single pipe)
Tables DO NOT render standalone or inside {info}/{note} — only inside {panel}.

### CR-04: Link formats
[Display Text|https://url] — external with text (always prefer display text)
[https://url] — raw URL only when display text not needed
[email@domain.com|mailto:email@domain.com] — email (MUST have display text before |)
[~jira-username] — user mention with avatar

WRONG: [mailto:email@domain.com] → shows "mailto:" as display text.

### CR-05: Inline code — double curly braces
{{repositories/ServiceA.ts}}  {{THRESHOLD = 0.65}}  {{customfield_10016}}
Use {{double_curly}} for file names, constants, field names, IDs.

### CR-06: Curly brace escaping in prose
{any_text} is parsed as a macro call → "Unknown macro" error.
When FRD content contains {field_names} patterns, MUST escape:
  WRONG:   trích xuất {amount, date, type}
  CORRECT: trích xuất {{amount, date, type}}

### CR-07: Icons — no emoji characters
Never use Unicode emoji (✅ ❌ ⚠️ 📋 🔧). Use Jira wiki icons:
  (/)  = green checkmark     (x)  = red X
  (!)  = warning amber       (i)  = info blue
  (*r) = red star            (*g) = green star
Icons render inside panel titles: {panel:title=(/) Acceptance Criteria|...}

### CR-08: Lists — always * (asterisk), never -
* First level          ** Second level (extra asterisk, NOT indented spaces)
WRONG: "  * nested" (spaces before * = plain text, not nested bullet)
Use # for ordered lists, ## for nested numbered.

### CR-09: Inline text effects
*bold* — labels, BR numbers   _italic_ — notes   {{mono}} — code values
-strikethrough- — no space inside dashes   +underline+ — rare
{quote}quoted text{quote} — block quotation (verified on jira.pila.vn)

### CR-10: Blank line after list before paragraph text
After a list block, always add a blank line before non-list paragraph text.
Without it, paragraph text is appended inside the last <li> element.
  WRONG: * item A  * item B  *Modified:* file.ts  ← bleeds into last li
  CORRECT: * item A  * item B  [blank line]  *Modified:* file.ts

### CR-11: Bold labels inside panels
All field labels: *label:* format.
  CORRECT: *FRD:* [link]   *As a* [persona]   *BR-01:* rule text
  WRONG:   FRD: [link]     **FRD:** [link]

---

## SC — Special Case Rules
*Apply ONLY when the specified condition is met.*

### SC-01: WHEN issue_type = Story
Structure: exactly 3 zones in this order, no more, no fewer.

  h3. ── PO REVIEW ─────────────────────────────────────────────
  ----
  [PO zone panels: User Story, Acceptance Criteria, Business Rules, INVEST]

  h3. ── DEVELOPMENT TEAM ──────────────────────────────────────
  ----
  [Dev zone panels: Technical Summary, Technical Quick Reference, Subtask Dependency Chain]

  h3. ── QC ZONE ───────────────────────────────────────────────
  ----
  [QC zone panels: Error Scenarios, TDD Test Contract]

Zone separator format: h3. ── [ZONE NAME] ──...─  followed by ---- on its own line.
No emojis in zone names.

### SC-02: WHEN issue_type = Subtask
Flat structure — NO zone separators, NO h3 headers, NO ---- rules.
Use ≤3 panels maximum in this order:
  1. Precondition (amber) — if prerequisites exist
  2. [ROLE] Task (blue) — main work description
  3. References (grey) — links to FRD, PRD, parent Story

Example:
  {panel:title=(!) Precondition|borderColor=#ff8b00|titleBGColor=#fff0b3|bgColor=#ffffff}
  * Condition must be met before starting this subtask
  {panel}

  {panel:title=(i) BE Task|borderColor=#0052cc|titleBGColor=#deebff|bgColor=#ffffff}
  * Implement service endpoint POST /api/v1/resource
  * Write unit tests, coverage ≥80%
  {panel}

  {panel:title=(i) References|borderColor=#6b778c|titleBGColor=#f4f5f7|bgColor=#ffffff}
  * *Story:* [KEY-NNN|https://jira.pila.vn/browse/KEY-NNN]
  * *FRD:* [FRD Title|https://cms.pila.vn/pages/XXXXXXXX]
  {panel}

### SC-03: WHEN section = Acceptance Criteria
Use table if ≥3 ACs; use bullet list if ≤2 ACs.
Table format inside {panel:title=(/) Acceptance Criteria|borderColor=#00875a|...}:
  || # || Condition || Expected Result ||
  | AC-01 | [trigger/input] | [expected output] |

Use (/) for pass, (x) for fail in Result column of INVEST table.

### SC-04: WHEN section = INVEST Quick Check
Always table format inside grey panel:
  {panel:title=INVEST Quick Check|borderColor=#6b778c|titleBGColor=#f4f5f7|bgColor=#ffffff}
  || Criterion || Result || Notes ||
  | I — Independent | (/) | justification |
  | N — Negotiable  | (/) | justification |
  | V — Valuable    | (/) | justification |
  | E — Estimable   | (x) | clarify then re-estimate |
  | S — Small       | (/) | justification |
  | T — Testable    | (/) | justification |
  {panel}

### SC-05: WHEN section = Dependency Chain
Use plain-text arrows inside grey panel — not list items:
  {panel:title=Subtask Dependency Chain|borderColor=#6b778c|titleBGColor=#f4f5f7|bgColor=#ffffff}
  BE-DB → BE-API → BE-TEST → QA → PO
  {panel}

### SC-06: WHEN issue_type = Epic
No zones. Use a brief overview structure:
  One blue panel: Business Context (problem + objectives)
  One green panel: Success Criteria (measurable outcomes)
  No subtask list in description — managed by Jira hierarchy.

---

## HP — Hard Prohibitions
*Violation → consequence → fix.*

### HP-01: Markdown syntax
❌ **bold**  _italic_ (Markdown)  ### Heading  [text](url)  ```code```
→ Renders as raw characters, not formatted
→ Fix: *bold*  _italic_ (Jira)  h3. Heading  [text|url]  {code}...{code}

### HP-02: HTML tags or entities
❌ <b> <div> <br> <span> <p> <table>  &amp; &lt; &gt;
→ Stripped or shown as literal HTML text
→ Fix: use literal characters & < > and Wiki Markup for formatting

### HP-03: {info}/{note}/{warning}/{tip} macros
❌ {info:title=...}  {note}  {warning}  {tip}
→ Shows as literal text on jira.pila.vn — not rendered as colored box
→ Fix: {panel:title=...|borderColor=...|titleBGColor=...|bgColor=#ffffff}

### HP-04: {color:...} macro
❌ {color:red}text{color}
→ Unreliable on Jira Server/DC
→ Fix: use panel border/title colors, or (!) (x) (/) icons for semantic color

### HP-05: Single curly brace in prose
❌ {field_name}  {amount, date}  (unescaped in description text)
→ Parsed as macro call → "Unknown macro: field_name" error visible in UI
→ Fix: {{field_name}} (monospace) or \{field_name\} (literal braces)

### HP-06: Emoji characters anywhere in description
❌ ✅ ❌ ⚠️ 📋 🔧 🧪 🎯 (Unicode emoji)
→ Do not render as icons in Jira Wiki Markup
→ Fix: (/) (x) (!) (i) (*r) (*g)

### HP-07: Dash prefix for list items
❌ - list item  (dash + space as unordered list marker)
→ Visually inconsistent; confused with strikethrough intent
→ Fix: * list item for all unordered lists

### HP-08: Nested panels
❌ {panel}outer{panel}inner{panel}{panel}{panel}
→ Inner panel shows as raw {panel:...} text — not rendered
→ Fix: flatten to sequential panels, or use h4. headers inside a single panel

### HP-09: Wrong email link format
❌ [mailto:user@domain.com]  → shows "mailto:" as visible display text
→ Fix: [user@domain.com|mailto:user@domain.com]

### HP-10: More than 3 zones in Story
❌ Adding a 4th zone (e.g. "── NOTES ──") to a Story description
→ Breaks the 3-zone standard expected by team reviewers
→ Fix: add supplementary content inside panels within existing zones

### HP-11: Verbatim FRD copy-paste (>3 consecutive lines)
❌ Reproducing full AC table, full TDD spec, full DDL SQL, full API JSON from FRD
→ Story is a summary + reference to FRD, not a mirror of it
→ Fix: extract key points, link to FRD section, keep descriptions concise

---

## Checklist — Pre-Submit Validation

Structure:
[ ] Story: exactly 3 zones (PO REVIEW / DEVELOPMENT TEAM / QC ZONE)
[ ] Subtask: ≤3 panels, flat (no zone h3 headers, no ----)
[ ] All colored blocks use {panel} with correct colors

Syntax:
[ ] No {info} {note} {warning} {tip} — use {panel} only
[ ] No Markdown: **bold** / ### heading / [text](url) / backtick-code
[ ] No HTML: <b> <div> <br> <span>
[ ] No emoji characters → use (/) (x) (!) (i)
[ ] No single {curly_brace} → escape as {{curly_brace}}
[ ] No dash list items "- item" → use "* item"

Content:
[ ] Lists use * for bullets, ** for nested (not spaces, not dashes)
[ ] Blank line after last list item before paragraph/bold text
[ ] Bold labels: *Label:* format
[ ] Links have display text: [FRD Title|url] not raw URL
[ ] Email links: [email|mailto:email] format
[ ] Tables only inside {panel} blocks
[ ] Inline code: {{double_curly}} not backtick
[ ] Icons in panel titles: (/) (x) (!) (i) — verified renders in title=

After Jira API response — verify renderedFields:
[ ] No literal {panel:... or {info:... text visible
[ ] Tables show as <table class='confluenceTable'> not raw || text
[ ] Icons show as <img class="emoticon"> not literal (/)
[ ] List items in <li> tags not plain paragraph
[ ] No paragraph text inside <li> that belongs outside the list
