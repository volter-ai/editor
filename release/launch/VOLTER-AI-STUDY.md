# www.volter.ai: what it says today, and what it should say (2026-10-08)

The owner: "Volter ai is the general company", and "volter.ai owns videogame.ai as a brand - so think about it like
xbox and microsoft. videogame.ai is for all our gaming stuff."

## Two versions exist

| | Live (Worker `volter-site`, deployed 2026-10-02) | Prepared, not launched (`sites/volter` on main, edits of 2026-10-04/05) |
|---|---|---|
| Title | "Volter — just enough reality" | same |
| Pitch | "The thinnest version of the real world that still behaves like it, so agents can build software on their own." Four sections: Thin reality, Unchanged, Glass box, One door | same |
| videogame.ai | "Case study · VideoGame AI", headline **"Game studios that run themselves."**, tiles Blender → Assets → **Engine** → Game, "Stoneguard Bridge and Relay" | "Case study · VideoGame AI", headline is a **placeholder**: "[COPY: a case-study headline … Do not claim studios run themselves …]", Engine tile removed |
| Tools list | 9 packages; two install lines out of date (`@volter/twin`, `@volter-ai-dev/supercode`) | install lines fixed (`@volter/world`, `@volter/supercode`) |
| Contact | "What are you building? Get in touch" (mailto contact@volter.ai) | same |

Other routes (the older React app, same on both): `/fellowship`, `/apply`, `/privacy`, `/terms`, titled "Volter AI".

## What is wrong

**1. It presents Volter as one product line, not the company.** The front page is the pitch for the mesh (twins,
substrate, harness: "just enough reality"). Under the owner's model, volter.ai is the parent company, Volter AI, Inc.,
and its brands are its businesses: videogame.ai (games, with Cyclotron released), Runhuman (people on call to agents)
and Open Autonomy (open projects that fund and run themselves), with the mesh as Volter's open tools. Today Runhuman and
Open Autonomy appear only as rows in a package list and mentions inside the mesh story; videogame.ai appears as a
customer-style "case study".

**2. videogame.ai is absent from what visitors see, and framed as a case study where it exists.** Live, the case-study
section and its nav link carry the HTML `hidden` attribute (parked until videogame.ai's release, per 0039), so a visitor
sees no videogame.ai at all; only the page source holds "VideoGame AI", "Game studios that run themselves." (0039:
autonomous studio operation is not evidenced) and the game editor's "Engine" tile. The prepared version un-hides the
section with its placeholder headline (seen rendered: the "[COPY: …]" text is the section's headline) and an eyebrow
that the page's small-caps style prints "CASE STUDY · VIDEOGAME AI". Under the Xbox model it is not a case study at all:
it is Volter's gaming brand. (Correction at 16:10Z: an earlier version of this note said the live page shows the claim;
it is hidden there.)

**3. The released product is missing.** Neither version names Cyclotron or links cyclotron.videogame.ai, the one
product launched this week.

**4. The prepared version cannot ship as is.** Its case-study headline is a "[COPY: …]" placeholder, and it still uses
the case-study frame.

**5. Live install lines are wrong.** `npm i @volter/twin` and `npm i -g @volter-ai-dev/supercode` (fixed on main only).

**6. The company is not stated anywhere a machine reads it.** No canonical, no structured data. The legal name "Volter AI,
Inc." appears nowhere on the site, while www.videogame.ai and the Cyclotron page now name
`https://www.volter.ai/#organization` (Volter, Volter AI, Inc.) as their parent; volter.ai should define that node, and
can list its brands.

**7. The legal pages invent their date.** `/privacy` and `/terms` print "Last updated: {today's date}" on every visit
(`new Date()`), and are written around "the Volter Fellowship program". Whether the Fellowship still runs is unknown to
me; the terms name no legal entity ("Volter", not Volter AI, Inc.).

**8. No socials.** The only outside link is GitHub (tabnode). X `@VolterAI` exists (verified, 40 followers); Instagram
`volterai` is empty ("Coming soon!"); the "volter.ai" Discord is the internal/tester server.

## What it should be (proposal)

A company home, short, in the same plotter visual language (decision 0028):

1. **Hero:** Volter, the company: one sentence on what it does for autonomous software, "Backed by a16z Speedrun and
   Konvoy" kept.
2. **Our companies / brands** (cards, each linking out):
   - **videogame.ai**: games and game-making tools; Cyclotron, the free open-source game editor (cyclotron.videogame.ai).
   - **Runhuman**: people on call to agents, as testers and reviewers (runhuman.com).
   - **Open Autonomy**: open projects that fund and run themselves (open-autonomy.org).
3. **The open tools (the mesh):** the "just enough reality" story, condensed to one section, with the package list
   (main's corrected install lines).
4. **Company:** investors, the Fellowship if it still runs, contact, legal; footer with Volter AI, Inc.
5. **Machine-readable:** canonical; Organization `https://www.volter.ai/#organization`, legalName Volter AI, Inc., with
   its brands (videogame.ai by its `@id`, Runhuman, Open Autonomy).
6. **Legal pages:** a fixed "last updated" date and the party named Volter AI, Inc.

**Right now, before any redesign:** the live case study states an unevidenced claim and shows the unreleased editor.
A minimal fix replaces that section with a videogame.ai card (the gaming brand, Cyclotron released) and the corrected
install lines, and can ship today.

## Decisions this touches

- **0039**, which set the case-study framing ("volter.ai's VideoGame AI case study is shown when videogame.ai is released").
- **0043** and STRATEGY.md's table, which give the Volter brand the role "the mesh". The owner's "Volter is the general
  company" puts Volter above the four parts; the table's wording follows.
- **0041** (sites deploy through a World): the deploy-procedure question already with the manager.
