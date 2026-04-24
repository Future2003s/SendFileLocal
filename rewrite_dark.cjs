const fs = require('fs');
const path = require('path');

const targetPath = 'd:\\WorkSpace\\SendFileLocal\\public\\index.html';
let content = fs.readFileSync(targetPath, 'utf8');

// ─── 1. CSS Variables & Overrides ───
content = content.replace(
    'background: linear-gradient(135deg, #f0f4ff 0%, #faf5ff 30%, #f8fafc 60%, #f0fdf4 100%);',
    'background: #020617; background-image: radial-gradient(circle at 15% 50%, rgba(99,102,241,0.08), transparent 25%), radial-gradient(circle at 85% 30%, rgba(168,85,247,0.08), transparent 25%); color: #f1f5f9;'
);

content = content.replace(/--glass-bg: rgba\(255, 255, 255, 0\.7\);/g, '--glass-bg: rgba(15, 23, 42, 0.6);');
content = content.replace(/--glass-border: rgba\(255, 255, 255, 0\.3\);/g, '--glass-border: rgba(255, 255, 255, 0.08);');
content = content.replace(/background: rgba\(255, 255, 255, 0\.75\)/g, 'background: rgba(15, 23, 42, 0.5)');
content = content.replace(/background: rgba\(255, 255, 255, 0\.92\)/g, 'background: rgba(15, 23, 42, 0.7)');
content = content.replace(/border: 1px solid rgba\(226, 232, 240, 0\.6\)/g, 'border: 1px solid rgba(255, 255, 255, 0.06)');

// Upload Zone
content = content.replace(/linear-gradient\(white, white\)/g, 'linear-gradient(#0f172a, #0f172a)');
content = content.replace(/linear-gradient\(rgba\(238, 242, 255, 0\.8\), rgba\(238, 242, 255, 0\.8\)\)/g, 'linear-gradient(rgba(30, 41, 59, 0.8), rgba(30, 41, 59, 0.8))');

// Category headers
content = content.replace(/background: #fafbff;/g, 'background: rgba(30,41,59,0.3);');
content = content.replace(/border-bottom: 2px solid #f8fafc;/g, 'border-bottom: 1px solid rgba(255,255,255,0.05);');

// ─── 2. Class Replacements ───
// Use exact word boundaries for some to avoid double replacement, 
// but since I mapped carefully, regular string replace works if ordered correctly.

const replacers = [
    ['text-slate-800', 'text-slate-200'],
    ['text-slate-900', 'text-slate-100'],
    ['text-slate-700', 'text-slate-300'],
    ['text-slate-600', 'text-slate-400'],
    ['text-slate-500', 'text-slate-400'],

    ['bg-white/90', 'bg-slate-900/90'],
    ['bg-white/85', 'bg-slate-900/85'],
    ['bg-white', 'bg-slate-900'],

    ['bg-slate-50/50', 'bg-slate-800/30'],
    ['bg-slate-50/30', 'bg-slate-800/20'],
    ['bg-slate-50', 'bg-slate-800/40'],
    ['bg-slate-100', 'bg-slate-800'],
    ['bg-slate-200', 'bg-slate-700/50'],

    ['hover:bg-slate-50', 'hover:bg-slate-800/70'],
    ['hover:bg-slate-100', 'hover:bg-slate-800'],
    ['hover:bg-slate-200', 'hover:bg-slate-700'],

    ['border-slate-50', 'border-slate-800/50'],
    ['border-slate-100', 'border-slate-800'],
    ['border-slate-200', 'border-slate-700'],
    ['border-slate-300', 'border-slate-600/50'],

    ['bg-blue-50/50', 'bg-blue-900/20'],
    ['bg-amber-50/50', 'bg-amber-900/20'],

    ['bg-blue-50', 'bg-blue-900/30'],
    ['bg-amber-50', 'bg-amber-900/30'],
    ['bg-amber-100', 'bg-amber-900/40'],
    ['bg-violet-50', 'bg-violet-900/30'],
    ['bg-purple-50', 'bg-purple-900/30'],
    ['bg-pink-50', 'bg-pink-900/30'],
    ['bg-yellow-50', 'bg-yellow-900/30'],
    ['bg-orange-50', 'bg-orange-900/30'],
    ['bg-emerald-50', 'bg-emerald-900/30'],
    ['bg-red-50', 'bg-red-900/30'],
    ['bg-green-50', 'bg-green-900/30'],
    ['bg-slate-800/40/50', 'bg-slate-800/30'], // fix double

    ['hover:bg-amber-100', 'hover:bg-amber-900/50'],
    ['hover:bg-violet-100', 'hover:bg-violet-900/50'],
    ['hover:bg-blue-100', 'hover:bg-blue-900/50'],
    ['hover:bg-red-50', 'hover:bg-red-900/40'],

    ['text-blue-600', 'text-blue-400'],
    ['text-amber-600', 'text-amber-400'],
    ['text-violet-600', 'text-violet-400'],
    ['text-indigo-600', 'text-indigo-400'],
    ['text-indigo-500', 'text-indigo-400'],

    ['from-indigo-500 to-purple-500', 'from-indigo-600 to-purple-600'],
    ['from-rose-500 to-red-500', 'from-rose-600 to-red-600'],
    ['from-amber-400 to-orange-500', 'from-amber-600 to-orange-600'],
];

for (const [from, to] of replacers) {
    content = content.split(from).join(to);
}

fs.writeFileSync(targetPath, content, 'utf8');
console.log('Class replacement complete!');
