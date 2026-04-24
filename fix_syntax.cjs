const fs = require('fs');
let html = fs.readFileSync('d:\\WorkSpace\\SendFileLocal\\public\\index.html', 'utf8');

// The replacement tool corrupted the window.buildFolderRow function body.
// Let's replace the whole window.buildFolderRow function with the correct one!

const oldStartStr = 'window.buildFolderRow = function buildFolderRow(folder) {';
const oldStartIdx = html.indexOf(oldStartStr);

const oldEndStr = 'window.buildRow = function buildRow(f) {';
const oldEndIdx = html.indexOf(oldEndStr);

if (oldStartIdx !== -1 && oldEndIdx !== -1) {
    const correctFunc = `window.buildFolderRow = function buildFolderRow(folder) {
    const encName = encodeURIComponent(folder.name);
    const isChecked = selectedFiles.has(encName);

    const colors = [
        'from-blue-100 to-blue-50 text-blue-600 shadow-blue-500/10',
        'from-teal-100 to-teal-50 text-teal-600 shadow-teal-500/10',
        'from-purple-100 to-purple-50 text-purple-600 shadow-purple-500/10',
        'from-orange-100 to-orange-50 text-orange-600 shadow-orange-500/10',
        'from-pink-100 to-pink-50 text-pink-600 shadow-pink-500/10'
    ];
    const colorClass = colors[folder.name.length % colors.length];

    const div = document.createElement("div");
    div.dataset.enc = encName;
    div.className = \`folder-row group relative p-4 rounded-3xl bg-gradient-to-br \${colorClass} shadow-sm border border-white/50 cursor-pointer hover:shadow-md hover:-translate-y-1 transition-all duration-300 flex flex-col justify-between h-32 aspect-[4/3] sm:aspect-auto\`;
  
    div.ondragover = (e) => { e.preventDefault(); div.classList.add('ring-4', 'ring-blue-400/50', 'ring-offset-2'); };
    div.ondragleave = () => { div.classList.remove('ring-4', 'ring-blue-400/50', 'ring-offset-2'); };
    div.ondrop = (e) => {
        e.preventDefault(); div.classList.remove('ring-4', 'ring-blue-400/50', 'ring-offset-2');
        const files = e.dataTransfer.files;
        if (files.length > 0) uploadToFolder(files, currentDir ? currentDir + '/' + folder.name : folder.name);
    };
  
    div.onclick = (e) => {
        if (e.target.closest('.action-btn')) return;
        navigateToDir(currentDir ? currentDir + '/' + folder.name : folder.name);
    };

    div.innerHTML = \`
        <div class="flex items-start justify-between">
           <div class="w-10 h-10 rounded-2xl bg-white/70 flex items-center justify-center shadow-sm">
              <i class="ph-fill ph-folder text-xl"></i>
           </div>
           <button class="action-btn w-8 h-8 rounded-full bg-white/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white" onclick="event.stopPropagation(); openDeleteModal('\${encName}', '\${folder.name.replace(/'/g, "\\\\'")}')"><i class="ph-bold ph-trash text-red-500"></i></button>
        </div>
        <div class="mt-auto">
           <h3 class="font-bold text-sm truncate pr-2 text-slate-800 leading-tight">\${folder.name}</h3>
           <span class="text-[10px] font-semibold opacity-70">\${folder.count || 0} mục &bull; \${fmt(folder.totalSize)}</span>
        </div>
    \`;
    return div;
};

`;
    html = html.substring(0, oldStartIdx) + correctFunc + html.substring(oldEndIdx);
    fs.writeFileSync('d:\\WorkSpace\\SendFileLocal\\public\\index.html', html, 'utf8');
    console.log('Successfully fixed index.html syntax error!');
} else {
    console.log('Could not find start/end indices for function replacement.');
}
