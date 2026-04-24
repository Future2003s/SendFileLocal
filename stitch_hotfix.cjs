const fs = require('fs');

const file = 'd:\\WorkSpace\\SendFileLocal\\public\\index.html';
const modalsText = fs.readFileSync('d:\\WorkSpace\\SendFileLocal\\modals.html', 'utf8');

let html = fs.readFileSync(file, 'utf8');

// Inject the modals
const modalRegex = /<!--\s*MODALS:\s*PREVIEW,\s*DELETE,\s*FOLDER\s*CREATE\s*-->[\s\S]*?<!--.*?-->/;
if (modalRegex.test(html)) {
    html = html.replace(modalRegex, modalsText);
} else {
    console.log('Modals hint not found, perhaps already injected?');
}

// Redefine the $() helper to gracefully fail instead of throwing TypeError.
const oldDollar = 'const $ = (id) => document.getElementById(id);';
const newDollar = 'const $ = (id) => document.getElementById(id) || document.createElement("div");';

if (html.includes(oldDollar)) {
    html = html.replace(oldDollar, newDollar);
} else {
    console.log('Could not find const $ = ... to perform hotfix.');
}

fs.writeFileSync(file, html, 'utf8');
console.log('Hotfix successfully applied!');
