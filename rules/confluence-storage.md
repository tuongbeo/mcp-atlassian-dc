# Confluence Storage Format — Rule Set
**Target**: cms.pila.vn (Confluence Data Center)
**Version**: 1.0.0

---

## CR — Common Rules
*Apply to ALL Confluence page content written via API, no exceptions.*

### CR-01: Macro syntax
All macros use structured-macro format:
  <ac:structured-macro ac:name="MACRO_NAME">
    <ac:parameter ac:name="PARAM">value</ac:parameter>
    <ac:rich-text-body>content</ac:rich-text-body>
  </ac:structured-macro>

For plain-text body (code blocks):
  <ac:plain-text-body><![CDATA[content here]]></ac:plain-text-body>

### CR-02: User mention format
Prefer ri:userkey (persistent). Use ri:username only as fallback.
  Preferred: <ac:link><ri:user ri:userkey="2c94808496e96b4c0196f7cd8bf30008" /></ac:link>
  Fallback:  <ac:link><ri:user ri:username="tuongpm" /></ac:link>

Use in table cells, paragraph text, headings — applies everywhere.
To look up a userkey: GET /rest/api/user?username=USERNAME → field "userKey"

### CR-03: Date format
<time datetime="YYYY-MM-DD" />  (ISO 8601 date, self-closing, no time component)
Use in meeting dates, due dates, timeline markers.

### CR-04: Table structure
<table>
  <tbody>
    <tr>
      <th style="background-color: #5243AA; color: white;">Header 1</th>
      <th style="background-color: #5243AA; color: white;">Header 2</th>
    </tr>
    <tr>
      <td>Data 1</td>
      <td>Data 2</td>
    </tr>
  </tbody>
</table>

Standard colors:
  Header cells: style="background-color: #5243AA; color: white;"
  Label cells:  style="background-color: #F3F2F1;"
  Multi-line cell: use <br/> inside <td>

### CR-05: Internal Jira issue links
Option A — plain hyperlink: <a href="https://jira.pila.vn/browse/KEY-123">KEY-123</a>
Option B — Jira macro (renders with status badge):
  <ac:structured-macro ac:name="jira">
    <ac:parameter ac:name="server">PILA Jira</ac:parameter>
    <ac:parameter ac:name="key">KEY-123</ac:parameter>
  </ac:structured-macro>

### CR-06: Text formatting
Bold: <strong>text</strong>  or  <b>text</b>
Italic: <em>text</em>
Paragraph: <p>content</p>
Line break: <br/>
Headings: <h1>Title</h1>  through  <h6>Smallest</h6>
Unordered list: <ul><li>item</li></ul>
Ordered list: <ol><li>item</li></ol>

---

## SC — Special Case Rules

### SC-01: WHEN page_type = meeting notes (Product Team Sync-up)
Use this header table structure at the top of the page:
  <table><tbody>
    <tr>
      <th colspan="2" style="background-color: #5243AA; color: white; text-align: center; font-size: 16px; padding: 10px;">
        <strong>YYYY-MM-DD Product Team Sync-up Meeting</strong>
      </th>
    </tr>
    <tr>
      <td style="width: 30%; background-color: #F3F2F1;"><strong>Sponsors:</strong></td>
      <td><ac:link><ri:user ri:userkey="USER_KEY" /></ac:link></td>
    </tr>
    <tr>
      <td style="background-color: #F3F2F1;"><strong>Date:</strong></td>
      <td><time datetime="YYYY-MM-DD" /></td>
    </tr>
    <tr>
      <td style="background-color: #F3F2F1;"><strong>Facilitator:</strong></td>
      <td><ac:link><ri:user ri:userkey="USER_KEY" /></ac:link></td>
    </tr>
  </tbody></table>

Module progress table: 8-column format with Progress, Stories In-Progress, Completed,
  Blocked, Risk, Action Items, Owner, Due Date headers.

### SC-02: WHEN embed = draw.io diagram (new diagram)
Use confluence_add_content with .drawio filename and mxGraph XML content.
This stores as custContentId format (not inline-XML).

  confluence_add_content(
    page_id="XXXXX",
    filename="diagram-name.drawio",
    content="<mxGraphModel>...</mxGraphModel>"
  )

Always add Flow Step Description table below the diagram (6 columns):
| # | Actor | Step | Description | Next on Success | Next on Failure |

### SC-03: WHEN embed = draw.io update (existing diagram)
First check storage format: confluence_get_content_properties(page_id)
  If inline-XML format: use confluence_update_drawio_diagram(page_id, xml, index)
  If custContentId format: use confluence_set_content_property(page_id, key, value)

### SC-04: WHEN embed = mermaid diagram
Use confluence_add_content with .mermaid or .mmd extension + mermaid syntax as content.
Worker auto-inserts the Mermaid macro into page body.

  confluence_add_content(
    page_id="XXXXX",
    filename="flow.mermaid",
    content="flowchart TD\n  A --> B"
  )

### SC-05: WHEN content = code block
  <ac:structured-macro ac:name="code">
    <ac:parameter ac:name="language">python</ac:parameter>
    <ac:parameter ac:name="theme">Midnight</ac:parameter>
    <ac:parameter ac:name="linenumbers">true</ac:parameter>
    <ac:plain-text-body><![CDATA[
def hello():
    print("hello world")
    ]]></ac:plain-text-body>
  </ac:structured-macro>

Supported languages: python, javascript, typescript, java, sql, bash, json, yaml, xml

### SC-06: WHEN content = panel/callout box
  <ac:structured-macro ac:name="panel">
    <ac:parameter ac:name="title">Panel Title</ac:parameter>
    <ac:parameter ac:name="borderColor">#0052cc</ac:parameter>
    <ac:parameter ac:name="titleBGColor">#deebff</ac:parameter>
    <ac:parameter ac:name="bgColor">#ffffff</ac:parameter>
    <ac:rich-text-body>
      <p>Panel content here</p>
    </ac:rich-text-body>
  </ac:structured-macro>

Info box (blue): <ac:structured-macro ac:name="info"><ac:rich-text-body>...</ac:rich-text-body></ac:structured-macro>
Note box (yellow): <ac:structured-macro ac:name="note"><ac:rich-text-body>...</ac:rich-text-body></ac:structured-macro>
Warning box (red): <ac:structured-macro ac:name="warning"><ac:rich-text-body>...</ac:rich-text-body></ac:structured-macro>
(These work in Confluence Storage Format, unlike Jira Wiki Markup)

---

## HP — Hard Prohibitions

### HP-01: Jira Wiki Markup syntax inside Confluence Storage Format
❌ {panel:title=...}  *bold*  [text|url]  h3. Heading  || table ||
→ Wiki markup renders as literal text in Confluence Storage Format
→ Fix: use HTML and ac:structured-macro syntax

### HP-02: Unescaped XML special characters in text content
❌ <p>Revenue > 1000 && name == "test" & more</p>
→ Invalid XML — API returns 400 error
→ Fix: &amp; &lt; &gt; &quot;   OR use CDATA: <![CDATA[content with & < > "]]>

### HP-03: Wrong user reference format
❌ @tuongpm  or  [~tuongpm]  (Wiki Markup user mention)
→ Does not resolve to a user in Confluence Storage Format
→ Fix: <ac:link><ri:user ri:userkey="..." /></ac:link>

### HP-04: Overriding Confluence styles with arbitrary HTML
❌ <div style="font-size: 24px; color: red; font-family: Comic Sans;">
→ Confluence strips many inline styles during save; result is unpredictable
→ Fix: use standard AC macros and approved style attributes (#5243AA headers, #F3F2F1 labels)

### HP-05: Plain text date strings instead of time macro
❌ <td>2026-04-29</td>  or  <td>April 29, 2026</td>
→ Not auto-linked to Confluence calendar; not timezone-aware
→ Fix: <td><time datetime="2026-04-29" /></td>

### HP-06: ri:username when userkey is available
❌ <ac:link><ri:user ri:username="tuongpm" /></ac:link> (when userkey is known)
→ Usernames can change; userkeys are permanent identifiers
→ Fix: use ri:userkey="2c94808496e96b4c0196f7cd8bf30008"
→ Reference: config/config.yaml in confluence-syncup-meeting skill for known userkeys

---

## Checklist — Pre-Submit Validation

Structure:
[ ] All macros use <ac:structured-macro ac:name="..."> syntax
[ ] User mentions use <ac:link><ri:user ri:userkey="..." /></ac:link>
[ ] Dates use <time datetime="YYYY-MM-DD" />
[ ] Tables use HTML <table><tbody><tr><th/><td/></tr></tbody></table>

Syntax:
[ ] No Jira Wiki Markup: {panel} *bold* [text|url] h3. Heading || table ||
[ ] No unescaped & < > " in XML text content
[ ] No @mentions or [~username] format
[ ] CDATA used for code blocks inside ac:plain-text-body

Content:
[ ] Header cells: background-color: #5243AA; color: white
[ ] Label cells: background-color: #F3F2F1
[ ] ri:userkey used (not ri:username) where known
[ ] Jira issue references use <a href> or jira macro
[ ] Code blocks use correct language parameter

After confluence_update_page response:
[ ] Page renders without literal {ac:structured-macro ...} text visible
[ ] User mentions show as clickable @DisplayName with avatar
[ ] Dates show as formatted date links
[ ] Tables render with purple headers
[ ] Draw.io diagrams show as interactive viewers (not as XML text)
