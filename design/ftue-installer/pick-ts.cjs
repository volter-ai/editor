const fs = require('fs');
const file = process.argv[2];
let s = fs.readFileSync(file, 'utf8');
const swap = (from, to) => { if (!s.includes(from)) throw new Error('missing: ' + from.slice(0, 60)); s = s.replace(from, to); };
swap("      selected = ids.map(rowIdFor).filter((id): id is string => id !== null);\n",
     "      // One row lookup per id: `rowIdForObject` scans the object rows, and a marquee over a\n      // large scene passes every object it covers.\n      const rowIds = ids.map(rowIdFor);\n      selected = rowIds.filter((id): id is string => id !== null);\n");
swap("      for (const id of ids) {\n        const rowId = rowIdFor(id);\n", "      const unnamed: string[] = [];\n      ids.forEach((id, index) => {\n        const rowId = rowIds[index]!;\n");
swap("          else if (!names.includes(name)) names.push(name);\n          continue;\n        }\n", "          else if (!names.includes(name)) names.push(name);\n          return;\n        }\n");
swap("        if (name !== null && !names.includes(name)) names.push(name);\n      }\n",
     "        if (name === null) unnamed.push(id);\n        else if (!names.includes(name)) names.push(name);\n      });\n      // Said, not swallowed: a picked object the view can't name is a selection Blender never gets.\n      if (unnamed.length > 0)\n        editorHost().console.warn(`No Blender object answers to ${unnamed.join(', ')}, so Blender's selection leaves ${unnamed.length === 1 ? 'it' : 'them'} out.`);\n");
fs.writeFileSync(file, s);
console.log('ok');
