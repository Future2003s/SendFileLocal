const fs = require('fs');

const idxPath = 'd:\\WorkSpace\\SendFileLocal\\public\\index.html';
const content = fs.readFileSync(idxPath, 'utf8');

const css = fs.readFileSync('d:\\WorkSpace\\SendFileLocal\\css_v2.css', 'utf8');
const bodyHTML = fs.readFileSync('d:\\WorkSpace\\SendFileLocal\\body_v2.html', 'utf8');
const scriptOverrides = fs.readFileSync('d:\\WorkSpace\\SendFileLocal\\script_v2.js', 'utf8');

// 1. Replace CSS
const cssRegex = /<style>[\s\S]*?<\/style>/;
let newContent = content.replace(cssRegex, `<style>\n${css}\n  </style>`);

// 2. Replace body markup up to the main <script> tag
// The main script tag starts on a new line like: `  <script>`
const scriptStartIdx = newContent.lastIndexOf('<script>');
const bodyStartIdx = newContent.indexOf('<body');

const beforeBody = newContent.substring(0, bodyStartIdx);
const scriptToEnd = newContent.substring(scriptStartIdx);

newContent = beforeBody + '<body class="text-slate-800 antialiased selection:bg-blue-100 selection:text-blue-900 overflow-hidden">\n' + bodyHTML + '\n  ' + scriptToEnd;

// 3. Inject JS overrides at the end of the <script> block, just before </script>
const scriptEndIdx = newContent.lastIndexOf('</script>');
const finalContent = newContent.substring(0, scriptEndIdx) + '\n\n' + scriptOverrides + '\n  ' + newContent.substring(scriptEndIdx);

fs.writeFileSync(idxPath, finalContent, 'utf8');
console.log('Stitch completed successfully!');
