```markdown
# Design System Strategy: The Technical Schematic

## 1. Overview & Creative North Star
**Creative North Star: "The Blueprint Archive"**

This design system is a digital extension of the workshop floor. It rejects the soft, consumer-grade aesthetics of modern web templates in favor of a high-end, industrial-editorial experience. It is a "Technical Schematic"—precise, utilitarian, and uncompromising. 

We achieve a signature look by leaning into **Architectural Brutalism**. By combining the raw precision of 0px corner radii with the sophisticated rhythm of monospace metadata and high-contrast typography, we create an interface that feels less like a website and more like a high-performance engineering tool. The layout should feel intentionally "constructed," utilizing the blueprint grid not just as a background, but as a rigid structural guide for every element.

---

## 2. Colors & Surface Architecture

The palette is rooted in a deep, nocturnal environment that prioritizes focus and visual endurance.

### The Color Tokens
- **Background (`surface_container_lowest`):** `#0F0F0F`. The foundation. Must feature the blueprint-dot pattern (1px dots, 32px spacing, 3% opacity) to provide a sense of scale.
- **Primary (`primary`):** `#FF6B35` (Safety Orange). This is our "Active State." Use it for high-priority CTAs and interactive focus.
- **Secondary (`secondary`):** `#B31B1B` (Cornell Crimson). Reserved for heritage accents and subtle brand anchors.
- **Surface Tiers:**
    - `surface_container_low`: `#131313` (General content areas)
    - `surface_container`: `#1A1A1A` (Cards and distinct modules)
    - `surface_container_high`: `#201F1F` (Hover states or nested components)

### The "No-Line" Rule for Sectioning
While the industrial aesthetic allows for 1px technical accents, **do not use solid 1px borders to separate major sections of the page.** Structure must be defined through tonal shifts. A `surface_container_low` section should sit directly against the `surface` background to create a boundary through value, not lines. 

### Surface Hierarchy & Nesting
Treat the UI as a series of physical plates. Use the "Nested Depth" principle: an inner card (`#1A1A1A`) should feel like it has been machined out of the larger background (`#0F0F0F`). 

### The "Glass & Gradient" Rule
To prevent the dark mode from feeling "flat" or "dead," use subtle gradients on primary CTAs (transitioning from `#FF6B35` to `primary_container`). For floating overlays (like tooltips or dropdowns), apply **Glassmorphism**: use a semi-transparent `#1A1A1A` with a 12px backdrop-blur. This simulates a "frosted polycarbonate" material common in lab environments.

---

## 3. Typography: The Editorial Engine

Typography is our primary tool for hierarchy. We use a three-font system to delineate between "Display," "Utility," and "Data."

| Role | Typeface | Weights | Style |
| :--- | :--- | :--- | :--- |
| **Headlines** | Space Grotesk | 500, 700 | Brutalist, tight tracking (-2%) |
| **Body** | Inter | 400, 500 | High legibility, standard tracking |
| **Metadata/Labels** | JetBrains Mono | 500 | ALL CAPS, Monospace technicality |

**The Identity Logic:**
- **Space Grotesk** (Headline) provides a human-yet-mechanical feel, reminiscent of mid-century Swiss design.
- **Inter** (Body) acts as the neutral workhorse, ensuring technical descriptions are readable at any scale.
- **JetBrains Mono** (Labels) is used exclusively for "UI Plumbing"—tags, timestamps, and technical specs—giving the user the sense they are looking at a live machine readout.

---

## 4. Elevation & Depth: Tonal Layering

Traditional shadows are prohibited. In a workshop, objects have weight and physical presence.

- **The Layering Principle:** Depth is achieved by stacking. A `surface_container_lowest` card on a `surface` background creates a "carved out" effect. 
- **Ambient Shadows:** When a floating effect is mandatory (e.g., a modal), use a massive, 64px blur at 8% opacity using the `on_surface` color. This creates an "atmospheric glow" rather than a drop shadow.
- **The "Ghost Border" Fallback:** For secondary buttons or subtle containment, use the `outline_variant` at 20% opacity. It should be barely visible—a "ghost" of a line that suggests a boundary without cluttering the technical space.
- **The Crosshair Motif:** Instead of rounded corners, use "Technical Crosshairs" (12px 1px lines) at the four corners of major hero sections or featured cards to reinforce the "targeting/precision" theme.

---

## 5. Components

### Buttons
- **Primary:** Background `primary` (#FF6B35), text `#0F0F0F`. Rectangular (0px). 
- **Secondary:** Transparent background, 1px border `primary` at 40% opacity. Text `primary`.
- **States:** On hover, the primary button should "flash" to a slightly lighter tint. On click, it should invert (Primary color text on transparent).

### Input Fields
- **Style:** Background `surface_container_highest`, bottom-border only (1px, `#2A2A2A`). 
- **Active State:** The bottom border transforms to `primary` (#FF6B35). Use JetBrains Mono for the label.

### Chips & Tags
- **Technical Tags:** Use JetBrains Mono, Uppercase, 10px size. Encased in a 1px border of `outline_variant` at 30% opacity. No fill.

### Cards & Lists
- **Rule:** Forbid the use of horizontal divider lines in lists. Instead, increase vertical padding (using a 16px/32px/48px scale) or use a subtle background hover state (`surface_container_high`) to separate items.

### Custom Component: The "Live Status" Indicator
A small, Cornell Crimson (#B31B1B) or Safety Orange (#FF6B35) "pulsing" dot next to monospace text to indicate machine availability or "Live" lab status.

---

## 6. Do's and Don'ts

### Do
- **DO** use asymmetry. Place a label in the top-left and the data in the bottom-right of a card to create a "technical document" flow.
- **DO** use 0px rounding on everything. Every corner must be a sharp 90-degree angle.
- **DO** snap every element to the 32px blueprint grid.

### Don't
- **DON'T** use soft shadows or rounded corners (this breaks the industrial aesthetic).
- **DON'T** use 100% opaque, high-contrast white dividers. They create "visual noise." Use background color shifts instead.
- **DON'T** use Cornell Crimson for large surfaces. It is an accent—a "stamp" of authority—not a primary paint color.
- **DON'T** use standard icons. Opt for thin-stroke (1px) technical icons that look like CAD drawings.

---

## 7. Interaction Pattern: The "Haptic" Digital
Interactions in this system should feel "mechanical." Use quick, snappy transitions (150ms-200ms) with a "Linear" or "Ease-In" curve. Avoid "bouncy" or "elastic" animations; the lab is a place of precision, not playfulness. Every hover state should feel like a light turning on in a machine.```