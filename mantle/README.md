# Own the route. Control the inbox. - Mantle Package

> Picket is a self-hosted email operations platform for teams that want to own their domains, mailboxes, routing, and data without inheriting the complexity and ugliness of traditional mail-server administration.

It combines familiar webmail with the operational controls of a serious email platform: multi-domain and multi-tenant administration, shared mailboxes, aliases, groups, access controls, durable delivery, routing, integrations, recovery tooling, and optional IMAP/SMTP access. It runs in the customer’s Cloudflare account, making ownership and inspectability central to the product.

PIcket’s core promise is: **your organization’s email, clearly organized and firmly under your control.**

The product should feel:

 - Protective, but not paranoid
 - Technically credible, but not intimidating
 - Calm, precise, and operationally dependable
 - Independent and self-owned
 - Modern without resembling another Gmail clone

 Its strongest brand themes are boundaries, stewardship, routing, watchfulness, coordination, and controlled access. The name “PIcket” can evoke a guarded perimeter, a reliable watch post, or a set of orderly markers guiding traffic. Favor the “clear boundary and dependable signal” interpretation over militaristic or restrictive imagery.

 The primary audience is technically capable small businesses, agencies, infrastructure-conscious teams, self-hosters, and organizations that manage multiple domains or shared addresses. They value autonomy and security, but still expect a polished, approachable daily email experience.

 Avoid:

 - Generic envelope-and-paper-plane branding
 - Hacker, cyberpunk, surveillance, or fortress aesthetics
 - Aggressive anti-Google messaging
 - Cold enterprise-security imagery
 - Excessively playful consumer branding
 - Claims that it replaces every feature of a mature hosted suite

 A suitable visual system would use structured geometry, clear boundaries, directional paths, or a distinctive waypoint/gate symbol. It should communicate that messages arrive at the correct place, authorized people have appropriate access, and operators can understand what the system is doing.

 The brand should ultimately make PIcket feel like a well-designed control point for organizational email: **open enough to own, disciplined enough to trust, and pleasant enough to use every day.**

A shorter positioning line would be:

**PIcket is the self-hosted email workspace that keeps your domains, delivery, and team access under your control.**

Potential tagline directions:

- **Email on your terms.**
- **Your mail. Your boundaries.**
- **A clearer way to own email.**
- **Team email, firmly in hand.**
- **Where your email belongs.**
- **Own the route. Control the inbox.**

---

## 📦 Package Contents

### Brand Assets
- **sigils/** - Logo files in multiple formats
  - Primary Sigil (PNG, PNG-Transparent, SVG)
  - Secondary Crest (PNG, PNG-Transparent, SVG)
  - Logo Variations: Simplified, Monochrome, Outline (PNG, PNG-Transparent, SVG each)

### Brand Data
- **mantle-identity.json** - Complete brand identity data in JSON format
- **mantle.css** - CSS variables and theme configuration
- **README.md** - This comprehensive brand guide

---

## 🎨 Color Palette

### Perimeter Navy
- **Hex:** `#0D1524`
- **Usage:** Primary dark neutral for backgrounds, dark surfaces, and high-emphasis typography.

### Waypoint Amber
- **Hex:** `#E06A3B`
- **Usage:** Primary brand accent, interactive indicators, routing signals, and key CTAs.

### Steward Teal
- **Hex:** `#1F4E66`
- **Usage:** Secondary brand color, access-control indicators, and multi-tenant domain tags.

### Coordinate Slate
- **Hex:** `#5A6B82`
- **Usage:** Secondary body text, metadata timestamps, table borders, and inactive route tracks.

### Canvas Mist
- **Hex:** `#F6F8FB`
- **Usage:** Primary light background and surface foundation for webmail reading surfaces.


---

## ✍️ Typography

### Header Font
- **Family:** Plus Jakarta Sans
- **Usage:** Headings, titles, and brand statements

### Body Font
- **Family:** IBM Plex Sans
- **Usage:** Body text, descriptions, and general content

### Font Pairing Rationale
Plus Jakarta Sans delivers geometric precision and clear, modern boundary-like letterforms for headers without feeling harsh or militaristic. IBM Plex Sans brings engineered credibility, exceptional legibility for multi-domain routing tables, headers, and email body text, reinforcing Picket's focus on dependable technical stewardship.

---

## 🌓 Theme Configuration

### Light Theme (Summer Mantle)
- **Background:** `#F6F8FB`
- **Surface:** `#FFFFFF`
- **Primary Text:** `#0D1524`
- **Secondary Text:** `#5A6B82`
- **Border:** `#E2E8F0`
- **Accent:** `#E06A3B`

### Dark Theme (Winter Mantle)
- **Background:** `#090E17`
- **Surface:** `#121C2D`
- **Primary Text:** `#F1F5F9`
- **Secondary Text:** `#94A3B8`
- **Border:** `#1E2E45`
- **Accent:** `#F07B4F`

---

## 🚀 Usage Guide

### Using the Logos

**SVG Files (Recommended for Web & Print)**
- Vector graphics that scale infinitely without quality loss
- Perfect for responsive web design, high-DPI displays, and print materials
- Can be styled with CSS (colors, sizes, etc.)

**PNG Files (Raster Images)**
- High-quality bitmap images
- **Standard PNG:** Original logo with background
- **Transparent PNG:** Files ending in `-transparent.png` have white backgrounds removed
- Use transparent versions for overlaying on colored backgrounds
- Ideal for social media, presentations, and quick mockups

### Implementing the CSS Theme

1. **Import the CSS file** into your project:
   \`\`\`html
   <link rel="stylesheet" href="mantle.css">
   \`\`\`

2. **Use the CSS variables** in your stylesheets:
   \`\`\`css
   .header {
     font-family: var(--font-header);
     color: var(--text-main);
     background: var(--bg-surface);
   }
   
   .button {
     background: var(--brand-accent);
     color: var(--text-on-accent);
   }
   \`\`\`

3. **Apply theme switching** with media queries (already configured in mantle.css)

### Brand Data JSON

The `mantle-identity.json` file contains all brand information in a structured format:
- Colors with hex values and usage guidelines
- Typography specifications
- Theme configurations for light and dark modes
- Logo metadata

Use this file to:
- Import brand data into design tools
- Automate brand asset generation
- Integrate with CMS or documentation systems

---

## 📋 Brand Guidelines

### Logo Usage
- Maintain clear space around logos (minimum 20% of logo height)
- Use Primary Sigil for main branding
- Use Secondary Crest for secondary applications
- Use variations for specific contexts (simplified for small sizes, monochrome for single-color applications)

### Color Application
- Use accent color sparingly for calls-to-action and highlights
- Maintain sufficient contrast ratios for accessibility (WCAG AA minimum)
- Refer to color usage guidelines in the palette section

### Typography Hierarchy
- Use header font for H1-H3 and brand statements
- Use body font for paragraphs, UI elements, and general text
- Maintain consistent font weights across applications

---

## 🛠️ Technical Specifications

- **Logo Formats:** PNG (raster), SVG (vector)
- **Color Space:** RGB (web), Hex codes provided
- **Font Formats:** Google Fonts (web-ready)
- **CSS Framework:** CSS Custom Properties (CSS Variables)
- **Theme Support:** Light and Dark modes with system preference detection

---

## 📄 License & Usage

This brand package was generated by Mantle, powered by Google Gemini AI.
All assets are provided for your use in accordance with your brand identity.

---

**Generated by Mantle** - The Identity Layer for Modern Brands
