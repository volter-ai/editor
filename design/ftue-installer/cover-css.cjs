const fs = require('fs');
const file = process.argv[2];
let css = fs.readFileSync(file, 'utf8');
const swap = (from, to) => { if (!css.includes(from)) throw new Error('missing: ' + from.slice(0, 60)); css = css.replace(from, to); };
swap(`     #e96a00  theme.color.content.selected     Blender's selection orange
`, `     #e96a00  theme.color.content.selected     Blender's selection orange

   and ONE that is not Blender's: #d8eb6a, the home page's \`lime-strong\` brand token, the ink of
   the machine's swapped-in parts and of the wait below, so the mascot is the page's machine.
`);
swap(`/* THE MARK: Blender's three viewport axes, as the one drawing this splash carries. Its colours
   are the traced \`viewport.axisX\`/\`axisY\` plus the Z blue Blender uses in the same gizmo, and
   it is inline SVG in the product's own markup — there is no image to fetch, which is what
   keeps the first frame the first frame. */
.volter-model-cover-mark {
	width: 56px;
	height: 56px;
	opacity: 0.92;
}
`, `/* THE MARK: the machine from the home page, this product's mascot (\`cyclotronMachine.ts\`). It is
   inline SVG in the product's own markup — there is no image to fetch, which is what keeps the first
   frame the first frame. The page draws it like a pen plotter: each part is one path one unit long
   (\`pathLength\`), its dash slides in after the parts before it (\`--part\`), the whole machine is
   drawn in about a second and a half, and then it floats, as it does on the page. */
.volter-model-cover-mark {
	width: 132px;
	height: 132px;
	margin-bottom: 4px;
	overflow: visible;
	animation: volter-model-cover-float 3.2s ease-in-out 1.6s infinite;
}

.volter-model-cover-part {
	fill: none;
	stroke: #e6e6e6;
	stroke-opacity: 0.9;
	stroke-width: 2.1;
	stroke-linecap: round;
	stroke-linejoin: round;
	stroke-dasharray: 1;
	stroke-dashoffset: 1;
	animation: volter-model-cover-plot 0.55s ease-out calc(var(--part) * 75ms) forwards;
}

.volter-model-cover-accent {
	stroke: #d8eb6a;
	stroke-opacity: 1;
}

@keyframes volter-model-cover-plot {
	to { stroke-dashoffset: 0; }
}

@keyframes volter-model-cover-float {
	0%, 100% { transform: translateY(0); }
	50% { transform: translateY(-3px); }
}
`);
swap(`/* The wait itself: a 2px rail with a travelling lick of Blender's selection orange. It is`,
     `/* The wait itself: a 2px rail with a travelling lick of the machine's lime. It is`);
swap(`	width: 40%;
	background: #e96a00;`, `	width: 40%;
	background: #d8eb6a;`);
css = css.trimEnd() + `

/* Without motion the machine is simply there, drawn, and the rail's lick holds still. */
@media (prefers-reduced-motion: reduce) {
	.volter-model-cover-mark { animation: none; }
	.volter-model-cover-part { animation: none; stroke-dashoffset: 0; }
	.volter-model-cover-rail::after { animation: none; left: 30%; }
}
`;
fs.writeFileSync(file, css);
console.log('ok');
