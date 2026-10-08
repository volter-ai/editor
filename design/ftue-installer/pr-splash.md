The owner, 2026-10-07: "the boot animation is no longer inline with our branding, we should use the 'machine' as the cyclotron that can be our 'mascot'".

Until now the splash drew Blender's three viewport axes. It now draws the home page's machine (volter-ai/sites `model-editor/src/assembly/scene.mjs`, the view of `media/assembly-poster.webp`), like a pen plotter:

- **`cyclotronMachine.ts`**: a hidden-line drawing generated from the page's own scene, not drawn by hand.
  - The generator loads `scene.mjs` with a stub renderer, poses the machine as the poster does, and raycasts each edge against every visible triangle.
  - 14 parts, one path each, in the page's reassembly order. 8 KB.
  - Fasteners under 4.4 units on screen are dropped so it reads at 132 px.
- **`product.contribution.ts`**: the cover builds the parts as SVG elements, as before: no markup, no image to fetch. `--part` is set through the CSSOM, not a `style` attribute.
- **`model-cover.css`**:
  - Each path is one unit long, and its dash plots in after the parts before it (75 ms apart, 0.55 s each, about 1.5 s for the whole machine). Then the machine floats 3 px, as it does on the page.
  - The valve covers and headers (React, three.js), and the wait rail's travelling lick, use the page's `lime-strong` (#d8eb6a). That is the one non-Blender colour, noted in the palette table.
  - Under reduced motion the drawing is still.

**Eye test.** I mocked the cover with the same markup and CSS and stepped through its animation at 150, 450, 800, 1200, 1700 and 3200 ms. The machine plots core-first and assembles outward, the lime parts land last, and it reads as the page's machine at 132 px on #161616. Frames are in `Desktop/volter/mascot/frames/strip.png` on volter-desktop.

**Shipping.** This is workbench source: it reaches users through a workbench release (the darwin-arm64, linux-x64 and win32-x64 builds plus the pins in `packages/cyclotron/package.json`), like the Chat welcome did. The browser editor (cyclotron-web) shows it after a rebuild from that release.

No tests run (repo rule). I didn't typecheck here; the file compiles inside the Code-OSS checkout at the workbench build.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
