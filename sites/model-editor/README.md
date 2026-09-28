# The Model Editor's home page

The Volter Model Editor's home page, served by this repository's GitHub Pages (owner decision, 2026-09-28: the Model
Editor's home is its GitHub Pages, and the Model Editor is open source).

- `src/` is the page and its stylesheet, drawn only with the brand's roles.
- `build.mjs` writes `dist/`: the page, the brand fetched from brand.volter.ai at build time (tokens, Geist faces, the
  product logo in both schemes, the favicon; the page loads nothing from brand.volter.ai), and `media/`'s launch video
  and poster. A failed fetch fails the build.
- `media/launch.mp4` is the launch footage: recorded from the editor's own tab on 0.5.79, the Chat pane's Claude Code
  building a desk lamp; the middle part runs at four times its speed, as the page says.

Publish: `node sites/model-editor/build.mjs`, then put `dist/` on the `gh-pages` branch, which Pages serves from its
root. Every claim on the page is one the README or a release states; change the page when they change.
