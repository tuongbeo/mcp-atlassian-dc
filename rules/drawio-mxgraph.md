# Draw.io mxGraph — Rule Set
**Target**: draw.io embedded in Confluence (cms.pila.vn)
**Version**: 1.0.0  |  **Tools**: Draw.io:create_diagram, Draw.io:create_from_mermaid

---

## CR — Common Rules
*Apply to ALL draw.io diagram generation, no exceptions.*

### CR-01: mxGraphModel XML root structure
Every diagram must start with this exact structure:
  <mxGraphModel dx="1422" dy="762" grid="1" gridSize="10" connect="1" arrows="1"
    fold="1" page="0" pageScale="1" pageWidth="1169" pageHeight="827" math="0" shadow="0">
    <root>
      <mxCell id="0" />
      <mxCell id="1" parent="0" />
      [all other cells here]
    </root>
  </mxGraphModel>

mxCell id="0" and id="1" are mandatory — they are the graph root and default parent.

### CR-02: Node declaration order
ALL nodes (vertices) must be declared BEFORE any edges.
Edges reference source and target by id — if the referenced id doesn't exist yet, the diagram breaks.

Correct order in <root>:
  1. mxCell id="0" and id="1"
  2. Pool container
  3. All swimlane cells
  4. All node cells (start events, activities, decisions, end events)
  5. All edge cells (connections between nodes)

### CR-03: Start and end events
Start event (solid black circle): style="ellipse;whiteSpace=wrap;aspect=fixed;fillColor=#000000;"
End event (bullseye): style="ellipse;whiteSpace=wrap;aspect=fixed;fillColor=#000000;strokeColor=#000000;double=1;"

Rules:
- Start event: exactly 1 outgoing edge, 0 incoming edges
- End event: ≥1 incoming edge, 0 outgoing edges
- Place start event at y=60 inside its swimlane (leaves room for swimlane header at y=0..30)

### CR-04: Cross-lane edges must parent to pool container
Edges that connect nodes in different swimlanes MUST have parent = pool container id (usually "2").
Edges connecting nodes in the same lane can have parent = that lane id.
When in doubt: set all edges to parent="2" (pool container) — always safe.

  CORRECT: <mxCell id="e1" edge="1" source="100" target="201" parent="2">
  WRONG:   <mxCell id="e1" edge="1" source="100" target="201" parent="10">

### CR-05: Unique cell IDs
Every mxCell must have a unique id attribute. Never reuse an id.
If you add a node, increment from the highest existing id in that lane's series.

### CR-06: Geometry calculations
Pool width = (number_of_lanes × 200) + 20
Pool height = (max_nodes_in_any_lane × 80) + 100
Lane width = 200 (fixed per lane)
Node vertical spacing: minimum 70px between center-points (node height=50 + gap=20)
First node y position inside lane: y=60 (below 30px lane header)

### CR-07: Node ID convention
Lane 1 nodes: 100, 101, 102, ...
Lane 2 nodes: 200, 201, 202, ...
Lane 3 nodes: 300, 301, 302, ...
Lane 4 nodes: 400, 401, ...
Edge IDs:     e1, e2, e3, ...
End event ID: 999 (always)

### CR-08: Node style catalog
Start event:   style="ellipse;whiteSpace=wrap;aspect=fixed;fillColor=#000000;"
End event:     style="ellipse;whiteSpace=wrap;aspect=fixed;fillColor=#000000;strokeColor=#000000;double=1;"
Activity:      style="rounded=1;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#333333;"
System action: style="rounded=1;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;"
Decision:      style="rhombus;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;"
Note/comment:  style="shape=note;whiteSpace=wrap;html=1;fillColor=#ffffcc;strokeColor=#999999;"

---

## SC — Special Case Rules

### SC-01: WHEN diagram_type = swimlane_activity (main journey diagram)
Use Draw.io:create_diagram with full mxGraph XML.

Pool container (id="2", parent="1"):
  style="shape=pool;startSize=20;horizontal=1;childLayout=stackLayout;
    horizontalStack=1;resizeParent=1;resizeParentMax=0;resizeLast=1;
    collapsible=0;marginBottom=0;swimlaneHead=0;
    fillColor=#dae8fc;strokeColor=#6c8ebf;"

Each swimlane (id="10","20","30"..., parent="2"):
  style="swimlane;startSize=30;horizontal=0;
    fillColor=#f5f5f5;strokeColor=#666666;fontColor=#333333;"
  Geometry: x = (lane_index × 200), y=0, width=200, height=pool_height

Edge style (for orthogonal routing):
  style="edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;"

Decision branches: add value="" to the edge for condition labels:
  <mxCell id="e3" value="Yes" edge="1" source="201" target="301" parent="2">

Minimum swimlanes: 2 (actor + system).
Typical swimlanes: User, App, Service/Backend, System (3-4 lanes).

### SC-02: WHEN diagram_type = mini_flowchart (compact story flow)
Use Draw.io:create_from_mermaid with flowchart TD.
Trigger: story has ≥3 ACs with distinct state transitions, ≥2 actors, ≥1 conditional branch.

Mermaid format:
  flowchart TD
    A([Start]) --> B[Step 1]
    B --> C{Decision?}
    C -->|Yes| D[Happy path]
    C -->|No| E[Error path]
    D --> F([End])

Max 8 nodes. Use different node shapes for actors.
Title format: "Flow: [Story ID] — [Story Title]"

### SC-03: WHEN action = embed_in_confluence (new diagram)
Use confluence_add_content with filename ending in .drawio and content = mxGraph XML.
This stores the diagram as a content property (custContentId format).

  confluence_add_content(
    page_id = "XXXXX",
    filename = "journey-diagram.drawio",
    content = "<mxGraphModel>...</mxGraphModel>"
  )

After embedding, always add Flow Step Description table below the diagram in the page.

### SC-04: WHEN action = update_existing_diagram
For inline-XML format: use confluence_update_drawio_diagram(page_id, diagram_xml, diagram_index)
For custContentId format: use confluence_set_content_property(page_id, property_key, value)
To check current format: use confluence_get_content_properties(page_id) first.

---

## HP — Hard Prohibitions

### HP-01: Dangling edge reference
❌ Edge with source="100" or target="201" where that id is not declared as a node
→ Diagram renders with missing connections or fails entirely
→ Fix: declare ALL nodes BEFORE edges; verify every source/target id exists

### HP-02: Wrong node parent (lane mismatch)
❌ Lane 2 node (id=200) with parent="10" (Lane 1's id)
→ Node renders inside wrong swimlane, layout broken
→ Fix: Lane N nodes must have parent = Lane N's cell id (10, 20, 30...)

### HP-03: Y-coordinate overlap (same lane, same y position)
❌ Two nodes in same lane both at y=120
→ Nodes overlap visually; diagram unusable
→ Fix: increment y by at least 70px per node: y=60, y=140, y=220, y=300...

### HP-04: Pool width insufficient for lane count
❌ Pool width="620" for 4 lanes → each lane only 155px, text clipped
→ Fix: width = (lanes × 200) + 20
  3 lanes: 620  |  4 lanes: 820  |  5 lanes: 1020

### HP-05: Cross-lane edge parented to swimlane (not pool)
❌ <mxCell edge="1" source="100" target="201" parent="10">
  where 100 is in lane 1 and 201 is in lane 2
→ Edge only visible within parent lane, disappears at lane boundary
→ Fix: cross-lane edges always use parent="2" (pool container id)

### HP-06: Using Excalidraw as fallback for activity diagrams
❌ Creating activity/UML diagrams in Excalidraw when Draw.io is unavailable
→ Excalidraw output format incompatible with draw.io; cannot be embedded or edited in Confluence draw.io viewer
→ Fix: block generation with placeholder, ask user to connect Draw.io MCP

### HP-07: Embedding Mermaid source code block as substitute
❌ Putting ```mermaid ...``` code block in description when diagram fails
→ Mermaid source in Confluence descriptions is not rendered — shows as raw text
→ Fix: use Draw.io:create_from_mermaid to convert first, then embed the draw.io result

---

## Checklist — Pre-Generate Validation

Before calling Draw.io:create_diagram or Draw.io:create_from_mermaid:

Structure:
[ ] mxGraphModel → root → mxCell id="0" → mxCell id="1" structure present
[ ] All nodes declared BEFORE edges in the XML
[ ] Pool container (id="2") present with correct style for swimlane diagrams

IDs and parents:
[ ] Every mxCell has unique id attribute (no duplicates)
[ ] Lane N nodes have parent = Lane N id (10, 20, 30...)
[ ] Cross-lane edges have parent = "2" (pool container)
[ ] Every edge source and target points to an existing node id

Geometry:
[ ] Pool width = (lanes × 200) + 20
[ ] No two nodes in same lane share the same y position
[ ] First node y ≥ 60 (below swimlane header)
[ ] Node spacing ≥ 70px vertical (height=50 + gap=20)

Graph rules:
[ ] Start event: exactly 1 outgoing edge, 0 incoming
[ ] End event: ≥1 incoming edge, 0 outgoing (id=999)
[ ] All decision nodes (rhombus) have ≥2 outgoing edges with labels
[ ] Diagram has at least 1 start event and 1 end event

For mini-diagrams (SC-02):
[ ] Trigger conditions met: ≥3 ACs, ≥2 actors, ≥1 branch
[ ] Node count ≤8
[ ] Using create_from_mermaid with flowchart TD
