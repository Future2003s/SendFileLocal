const fs = require('fs');

let indexHtml = fs.readFileSync('public/index.html', 'utf8');
const bodyStart = indexHtml.indexOf('<body');
const headContent = indexHtml.substring(0, bodyStart);

let bodyHtml = fs.readFileSync('body_v2.html', 'utf8');

// Strip out the STORAGE WIDGET
const storageRegex = /<!--\s*STORAGE WIDGET\s*-->[\s\S]*?(<div class="mt-6[^>]*>[\s\S]*?<\/div>\s*<\/div>\s*<\/div>)/;
bodyHtml = bodyHtml.replace(storageRegex, '');

let modalsHtml = fs.readFileSync('modals.html', 'utf8');
let scriptJs = fs.readFileSync('test.js', 'utf8');

// Also safely clear tracking code for storage used just inside the JS
scriptJs = scriptJs.replace(/document\.getElementById\('storage-used'\)\.innerText\s*=\s*"Vài GB";/g, '');

const finalHtml = headContent +
    '<body class="text-slate-800 antialiased selection:bg-blue-100 selection:text-blue-900 overflow-hidden">\n' +
    bodyHtml + '\n' +
    modalsHtml + '\n' +
    '<script>\n' + scriptJs + '\n</script>\n' +
    '</body>\n</html>';

fs.writeFileSync('public/index.html', finalHtml, 'utf8');
console.log('Successfully rescued index.html!');
