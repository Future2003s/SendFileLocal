const fs = require('fs');

let html = fs.readFileSync('d:\\WorkSpace\\SendFileLocal\\public\\index.html', 'utf8');

// The corruption is around "window.buildRow = " and "window.renderFiles ="
// We can just find all instances of \\\` and \\$ and replace them with \` and $
// since no valid JS in this file uses literal backward slashes before backticks.

let newHtml = html.replace(/\\`/g, '`');
newHtml = newHtml.replace(/\\\$/g, '$');

fs.writeFileSync('d:\\WorkSpace\\SendFileLocal\\public\\index.html', newHtml, 'utf8');
console.log('Fixed backslashes!');

const c = newHtml;
const m = c.match(/<script>[\s\S]*?<\/script>/g) || [];
fs.writeFileSync('d:\\WorkSpace\\SendFileLocal\\test.js', m.join('\n').replace(/<\/?script>/g, ''));
console.log('Saved test.js for validation');
