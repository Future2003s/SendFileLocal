const fs = require('fs');

const targetPath = 'd:\\WorkSpace\\SendFileLocal\\public\\index.html';
let content = fs.readFileSync(targetPath, 'utf8');

const regexStyle = /<style>([\s\S]*?)<\/style>/;
let styleBlock = content.match(regexStyle)[1];

// Inject Glowing blobs into body
styleBlock = styleBlock.replace('body {', 'body { position: relative; z-index: 0;');
if (!styleBlock.includes('body::before')) {
    styleBlock += `
    body::before {
      content: ''; position: fixed; top: -10%; left: -10%; width: 50vw; height: 50vh;
      background: radial-gradient(circle, rgba(99, 102, 241, 0.15), transparent 60%);
      border-radius: 50%; z-index: -1; filter: blur(60px); pointer-events: none;
    }
    body::after {
      content: ''; position: fixed; bottom: -10%; right: -10%; width: 50vw; height: 50vh;
      background: radial-gradient(circle, rgba(168, 85, 247, 0.1), transparent 60%);
      border-radius: 50%; z-index: -1; filter: blur(60px); pointer-events: none;
    }
  `;
}

// Fix Search Input
styleBlock = styleBlock.replace(/border: 1.5px solid #e0e7ff;/g, 'border: 1.5px solid rgba(255,255,255,0.06);');
styleBlock = styleBlock.replace(/color: #334155;/g, 'color: #e2e8f0;');
styleBlock = styleBlock.replace(/background: rgba\(15, 23, 42, 0.5\);/g, 'background: rgba(15, 23, 42, 0.6); backdrop-filter: blur(12px); box-shadow: 0 4px 20px rgba(0,0,0,0.5);');
styleBlock = styleBlock.replace(/border-color: #818cf8;/g, 'border-color: #6366f1;');
styleBlock = styleBlock.replace(/background: #020617;/g, 'background: #020617;'); // it's already there

// Fix Sort Dropdown
styleBlock = styleBlock.replace(/border: 1.5px solid rgba\(255, 255, 255, 0.08\);/g, 'border: 1px solid rgba(255,255,255,0.08);');
styleBlock = styleBlock.replace(/background: rgba\(15, 23, 42, 0.7\); backdrop-filter/g, 'background: rgba(15, 23, 42, 0.85); backdrop-filter');
styleBlock = styleBlock.replace(/color: #475569;/g, 'color: #94a3b8;');
styleBlock = styleBlock.replace(/color: #4338ca;/g, 'color: #c7d2fe;');

// Fix No Results
styleBlock = styleBlock.replace(/color: #94a3b8;/g, 'color: #64748b;');

// Fix Toast Modal
styleBlock = styleBlock.replace(/border-slate-100/g, 'border-slate-800');

content = content.replace(regexStyle, `<style>${styleBlock}</style>`);

// Fix Sidebar Colors directly in HTML if the previous replacer caused issues
content = content.replace(/divide-slate-100/g, 'divide-slate-800/50');
content = content.replace(/border-slate-100/g, 'border-slate-800/50');
content = content.replace(/border-indigo-50/g, 'border-indigo-900/20');
content = content.replace(/bg-white\/90/g, 'bg-slate-900/90');
content = content.replace(/bg-slate-50/g, 'bg-slate-800/40');
content = content.replace(/border-slate-200/g, 'border-slate-700');

fs.writeFileSync(targetPath, content, 'utf8');
console.log('CSS Injection successful');
