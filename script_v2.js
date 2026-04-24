// This script contains the new DOM build functions that will replace old ones via script. 
// It needs to be injected into the existing <script> block.

// ─── OVERRIDE DOM BUILDERS FOR BENTO GRID ───
window.buildFolderRow = function buildFolderRow(folder) {
  const encName = encodeURIComponent(folder.name);
  const isChecked = selectedFiles.has(encName);

  // Choose random bento colors dynamically based on alphabetical letter or name length
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
    handleFolderDrop(e, encName);
  };
  
  // Folder click opens it. Checkbox toggle logic is absolute
  div.onclick = (e) => {
    if (e.target.closest('.action-btn')) return;
    openDir(folder.name);
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
       <span class="text-[10px] font-semibold opacity-70">\${folder.count || 0} mục \u2022 \${fmt(folder.totalSize)}</span>
    </div>
       <button class="action-btn w-8 h-8 rounded-full bg-white/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white" onclick="event.stopPropagation(); openDeleteModal('${encName}', '${folder.name.replace(/'/g, "\\'")}')"><i class="ph-bold ph-trash text-red-500"></i></button>
    </div>
    <div class="mt-auto">
       <h3 class="font-bold text-sm truncate pr-2 text-slate-800 leading-tight">${folder.name}</h3>
       <span class="text-[10px] font-semibold opacity-70">${folder.count || 0} mục \u2022 ${fmt(folder.totalSize)}</span>
    </div>
  `;
  return div;
};

window.buildRow = function buildRow(f) {
  const fileName = f.name.normalize("NFC");
  const props = fileProps(fileName);
  const encName = encodeURIComponent(fileName);
  const isChecked = selectedFiles.has(encName);
  const dirParam = currentDir ? `?dir=${encodeURIComponent(currentDir)}` : '';

  const div = document.createElement("div");
  div.dataset.enc = encName;
  div.className = `file-row relative flex flex-col p-4 rounded-[24px] bg-white border ${isChecked ? 'border-blue-400 ring-2 ring-blue-100' : 'border-slate-100'} shadow-[0_4px_20px_rgba(0,0,0,0.03)] cursor-pointer hover:shadow-[0_8px_30px_rgba(0,0,0,0.08)] hover:-translate-y-1 transition-all duration-300 group`;

  div.onclick = (e) => {
    if (e.target.closest('button') || e.target.closest('a')) return;
    openPreviewModal(encName, fileName);
  };

  const checkIcon = isChecked ? '<i class="ph-bold ph-check text-white text-[10px]"></i>' : '';
  const checkClass = isChecked ? 'bg-blue-500 border-none' : 'bg-transparent border-2 border-slate-200';
  const iconBg = props.bg.replace('bg-', 'bg-').replace('-50', '-100');
  const safeFileName = fileName.replace(/'/g, "\\'");
  const safeEncName = encName.replace(/'/g, "\\'");

  div.innerHTML = `
    <div class="flex items-start justify-between absolute top-3 right-3 z-10 w-full px-6 flex-row-reverse">
       <button onclick="event.stopPropagation(); toggleSelect('${safeEncName}')" class="action-btn w-6 h-6 rounded-full ${checkClass} flex items-center justify-center transition-colors">
          ${checkIcon}
       </button>
    </div>

    <div class="w-12 h-12 rounded-2xl ${iconBg} flex items-center justify-center mb-3 mt-1 shadow-inner shrink-0 relative">
      <i class="ph-fill ${props.icon} ${props.color} text-2xl"></i>
    </div>

    <div class="mt-auto">
       <h3 class="font-bold text-sm text-slate-700 line-clamp-2 leading-snug break-all group-hover:text-blue-600 transition-colors">${fileName}</h3>
       <div class="flex items-center justify-between mt-2">
         <span class="text-[10px] font-bold text-slate-400 bg-slate-50 px-2 py-0.5 rounded-lg border border-slate-100">${fmt(f.size)}</span>
         <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button class="action-btn w-7 h-7 bg-slate-50 hover:bg-slate-100 rounded-full flex items-center justify-center text-slate-500 hover:text-teal-600 transition-all" onclick="event.stopPropagation(); shareFileLink('${safeEncName}', '${dirParam}')" title="Chia sẻ link tải">
               <i class="ph-bold ph-share-network"></i>
            </button>
            <a href="/download/${encName}${dirParam}" download="${fileName}" class="action-btn w-7 h-7 bg-slate-50 hover:bg-slate-100 rounded-full flex items-center justify-center text-slate-500 hover:text-blue-600 transition-all" onclick="event.stopPropagation()">
               <i class="ph-bold ph-download-simple"></i>
            </a>
            <button class="action-btn w-7 h-7 bg-slate-50 hover:bg-slate-100 rounded-full flex items-center justify-center text-slate-500 hover:text-red-500 transition-all" onclick="event.stopPropagation(); openDeleteModal('${safeEncName}', '${safeFileName}')">
               <i class="ph-bold ph-trash"></i>
            </button>
         </div>
       </div>
    </div>
  `;
  return div;
};

// Override renderFiles because the layout structure completely changed (Removed groups)
window.renderFiles = function renderFiles(files, folders) {
  let filteredFiles = currentSearchTerm ? files.filter(f => f.name.toLowerCase().includes(currentSearchTerm)) : files;
  let filteredFolders = currentSearchTerm ? folders.filter(f => f.name.toLowerCase().includes(currentSearchTerm)) : folders;
  currentFiles = filteredFiles;

  const fSection = document.getElementById('folders-section');
  const dSection = document.getElementById('files-section');
  const emptyState = document.getElementById('empty-state');
  const noSearch = document.getElementById('no-search-results');
  const fGrid = document.getElementById('folders-grid');
  const dGrid = document.getElementById('files-grid');

  fGrid.innerHTML = ''; dGrid.innerHTML = '';
  fSection.classList.add('hidden'); dSection.classList.add('hidden');
  emptyState.classList.add('hidden'); noSearch.classList.add('hidden');

  if (files.length === 0 && folders.length === 0) {
    emptyState.classList.remove('hidden'); return;
  }
  if (currentSearchTerm && filteredFiles.length === 0 && filteredFolders.length === 0) {
    noSearch.classList.remove('hidden'); return;
  }

  // Sort logic applies normally
  filteredFiles = sortFiles(filteredFiles);
  if (currentSortMode === 'size-desc') filteredFolders = [...filteredFolders].sort((a, b) => (b.totalSize || 0) - (a.totalSize || 0));
  else if (currentSortMode === 'size-asc') filteredFolders = [...filteredFolders].sort((a, b) => (a.totalSize || 0) - (b.totalSize || 0));
  else if (currentSortMode === 'name-desc') filteredFolders = [...filteredFolders].sort((a, b) => b.name.localeCompare(a.name));

  let totalDSize = 0;
  if (filteredFolders.length > 0) {
    fSection.classList.remove('hidden');
    let fSize = 0;
    for (const folder of filteredFolders) {
      fGrid.appendChild(buildFolderRow(folder));
      fSize += (folder.totalSize || 0);
    }
    document.getElementById('folders-size').innerText = fmt(fSize);
  }

  if (filteredFiles.length > 0) {
    dSection.classList.remove('hidden');
    for (const file of filteredFiles) {
      dGrid.appendChild(buildRow(file));
      totalDSize += (file.size || 0);
    }
    document.getElementById('files-size').innerText = fmt(totalDSize);
  }

  // Storage usage tracking
  document.getElementById('storage-used').innerText = "Vài GB"; // Mock since server.js doesn't sum entire drive
};

// Helper overrides
window.switchTab = function switchTab(tabId) {
  const isFiles = tabId === 'files';
  // Mobile pill animation
  const pill = document.getElementById('nav-active-pill');
  if (pill) pill.style.transform = isFiles ? 'translateX(0)' : 'translateX(100%)';

  // Desktop active states
  const navF = document.getElementById('nav-files-desktop');
  const navC = document.getElementById('nav-clipboard-desktop');
  if (navF && navC) {
    if (isFiles) {
      navF.className = 'sidebar-btn active flex items-center gap-3 px-4 py-2.5 rounded-2xl font-semibold transition-all bg-blue-50 text-blue-600 shadow-sm';
      navC.className = 'sidebar-btn flex items-center gap-3 px-4 py-2.5 rounded-2xl font-semibold transition-all text-slate-600 hover:bg-white/40';
    } else {
      navC.className = 'sidebar-btn active flex items-center gap-3 px-4 py-2.5 rounded-2xl font-semibold transition-all bg-blue-50 text-blue-600 shadow-sm';
      navF.className = 'sidebar-btn flex items-center gap-3 px-4 py-2.5 rounded-2xl font-semibold transition-all text-slate-600 hover:bg-white/40';
    }
  }

  // Toggle panels
  if (window.innerWidth < 768) {
    document.getElementById('tab-clipboard').classList.toggle('hidden', isFiles);
    document.getElementById('tab-files').classList.toggle('hidden', !isFiles);
  }
};
