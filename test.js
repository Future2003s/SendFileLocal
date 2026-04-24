
    // ─── UTILS ────────────────────────────────────────────────────────────────
    const $ = (id) => document.getElementById(id) || document.createElement("div");
    const isLocalPreview = ['blob:', 'file:', 'data:'].includes(window.location.protocol);
    let _pinTimer = null;

    // ─── TABS MANAGEMENT (Mobile) ─────────────────────────────────────────────
    function switchTab(tabId) {
      if (window.innerWidth >= 768) return; // Desktop luôn hiện cả 2

      const isFiles = tabId === 'files';
      const tabFiles = $('tab-files');
      const tabClip = $('tab-clipboard');

      const fab = $('fab-upload');
      if (isFiles) {
        tabFiles.classList.remove('tab-hidden');
        tabClip.classList.remove('tab-active');
        if (fab) fab.style.display = '';
      } else {
        tabFiles.classList.add('tab-hidden');
        tabClip.classList.add('tab-active');
        if (fab) fab.style.display = 'none';
        // Scroll clipboard to bottom when opened
        setTimeout(() => {
          const list = $('clipboard-list');
          list.scrollTop = list.scrollHeight;
        }, 50);
      }

      // Update Nav UI
      const navF = $('nav-files');
      const navC = $('nav-clipboard');

      if (isFiles) {
        navF.classList.replace('text-slate-400', 'text-blue-400');
        navF.querySelector('.nav-indicator').classList.replace('bg-transparent', 'bg-blue-100');
        navF.querySelector('i').classList.replace('ph', 'ph-fill');

        navC.classList.replace('text-blue-400', 'text-slate-400');
        navC.querySelector('.nav-indicator').classList.replace('bg-blue-100', 'bg-transparent');
        navC.querySelector('i').classList.replace('ph-fill', 'ph');
      } else {
        navC.classList.replace('text-slate-400', 'text-blue-400');
        navC.querySelector('.nav-indicator').classList.replace('bg-transparent', 'bg-blue-100');
        navC.querySelector('i').classList.replace('ph', 'ph-fill');

        navF.classList.replace('text-blue-400', 'text-slate-400');
        navF.querySelector('.nav-indicator').classList.replace('bg-blue-100', 'bg-transparent');
        navF.querySelector('i').classList.replace('ph-fill', 'ph');
      }
    }

    // Xử lý resize để reset layout trên desktop/mobile
    window.addEventListener('resize', () => {
      const tabFiles = $('tab-files');
      const tabClip = $('tab-clipboard');
      if (window.innerWidth >= 768) {
        // Desktop: clear mobile-specific classes
        tabFiles.classList.remove('tab-hidden');
        tabClip.classList.remove('tab-active');
      } else {
        // Re-apply active tab state
        const isClipboardActive = $('nav-clipboard').classList.contains('text-blue-400');
        switchTab(isClipboardActive ? 'clipboard' : 'files');
      }
    });

    // ─── LAZY LOADER ─────────────────────────────────────────────────────────
    const _loaded = new Set();
    function lazyLoad(src) {
      if (_loaded.has(src)) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = () => { _loaded.add(src); resolve(); };
        s.onerror = reject;
        document.head.appendChild(s);
      });
    }

    // ─── MOCK DATA ────────────────────────────────────────────────────────────
    let mockFiles = isLocalPreview ? [
      { name: "Thiết_kế_UI_App.png", size: 1048576, url: null },
      { name: "Báo_cáo_tài_chính_Q3.pdf", size: 5242880, url: null },
      { name: "Source_code_update.zip", size: 850000, url: null }
    ] : [];
    let mockClipboard = isLocalPreview ? [
      { id: 1, text: "Link Figma bản nháp:\nhttps://figma.com/file/...", timestamp: Date.now() - 300000 },
      { id: 2, text: "Mã màu xanh chủ đạo là #3B82F6 nhé", timestamp: Date.now() - 86400000 }
    ] : [];

    let currentFiles = [];
    let currentFolders = [];
    let selectedFiles = new Set();
    let currentFilesToDelete = [];
    let _pendingFolderDelete = null; // { folderName, fullPath }
    let lastEtag = null;
    let _refreshTimer = null;
    let _toastTimer = null;

    // ─── FOLDER NAVIGATION ────────────────────────────────────────────
    let currentDir = '';

    // Đọc dir từ URL hash khi mở trang
    function initDirFromHash() {
      const hash = location.hash.slice(1);
      const params = new URLSearchParams(hash);
      currentDir = params.get('dir') || '';
    }

    function updateHash() {
      if (currentDir) {
        location.hash = `dir=${encodeURIComponent(currentDir)}`;
      } else {
        history.replaceState(null, '', location.pathname + location.search);
      }
    }

    function navigateToDir(dir) {
      currentDir = dir;
      updateHash();
      lastEtag = null;
      selectedFiles.clear();
      refresh(true);
    }

    // Breadcrumb render
    function renderBreadcrumb() {
      const bar = $('breadcrumb-bar');
      const parts = currentDir ? currentDir.split('/').filter(Boolean) : [];

      let html = `<button onclick="navigateToDir('')" class="flex items-center gap-1 px-2 py-1 rounded-lg font-semibold transition-colors whitespace-nowrap ${!currentDir ? 'text-blue-400 bg-blue-900/30' : 'text-slate-400 hover:text-slate-300 hover:bg-slate-800'}">
        <i class="ph-fill ph-house text-sm"></i> Gốc
      </button>`;

      let pathSoFar = '';
      for (let i = 0; i < parts.length; i++) {
        pathSoFar += (pathSoFar ? '/' : '') + parts[i];
        const isLast = i === parts.length - 1;
        const dirPath = pathSoFar;
        html += `<i class="ph ph-caret-right text-slate-300 text-xs shrink-0"></i>`;
        html += `<button onclick="navigateToDir('${dirPath.replace(/'/g, "\\'")}')" class="px-2 py-1 rounded-lg font-semibold transition-colors whitespace-nowrap ${isLast ? 'text-blue-400 bg-blue-900/30' : 'text-slate-400 hover:text-slate-300 hover:bg-slate-800'}">
          <i class="ph-fill ph-folder text-sm"></i> ${parts[i]}
        </button>`;
      }

      bar.innerHTML = html;
    }

    // Tạo thư mục mới — mở modal
    function promptCreateFolder() {
      const modal = $('folder-modal');
      const input = $('folder-name-input');
      input.value = '';
      modal.classList.remove('hidden');
      requestAnimationFrame(() => modal.classList.remove('opacity-0'));
      setTimeout(() => input.focus(), 300);
    }

    function closeFolderModal() {
      const modal = $('folder-modal');
      modal.classList.add('opacity-0');
      setTimeout(() => modal.classList.add('hidden'), 200);
    }

    async function executeFolderCreate() {
      const name = $('folder-name-input').value;
      if (!name || !name.trim()) {
        $('folder-name-input').focus();
        return;
      }
      closeFolderModal();

      showStatus('Đang tạo thư mục...', 'loading');
      try {
        const res = await safeFetch('/api/folders', {
          method: 'POST',
          headers: { ...headers(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim(), dir: currentDir })
        });
        if (res.ok) {
          const data = await res.json();
          showStatus(`Đã tạo thư mục "${data.name || name}"`, 'success');
          lastEtag = null;
          refresh(true);
        } else {
          const data = await res.json?.() || {};
          showStatus(data.error || 'Lỗi tạo thư mục', 'error');
        }
      } catch (e) {
        showStatus('Lỗi kết nối', 'error');
      }
    }

    // Xóa thư mục — mở modal xác nhận
    function deleteFolder(folderName) {
      const fullPath = currentDir ? `${currentDir}/${folderName}` : folderName;
      _pendingFolderDelete = { folderName, fullPath };
      currentFilesToDelete = [];
      $('delete-message').textContent = `Xóa thư mục và toàn bộ nội dung bên trong?`;
      $('delete-filename').textContent = folderName;
      const modal = $('delete-modal');
      modal.classList.remove('hidden');
      setTimeout(() => modal.classList.remove('opacity-0'), 10);
    }

    // Chia sẻ đường dẫn
    async function shareCurrentLink() {
      const url = window.location.origin + window.location.pathname + (currentDir ? `#dir=${encodeURIComponent(currentDir)}` : '');
      try {
        await navigator.clipboard.writeText(url);
        showStatus('Đã sao chép đường dẫn!', 'success');
      } catch {
        // Fallback
        const t = document.createElement('textarea');
        t.value = url;
        document.body.appendChild(t); t.select(); document.execCommand('copy'); document.body.removeChild(t);
        showStatus('Đã sao chép đường dẫn!', 'success');
      }
    }

    // Lắng nghe hash change (để back/forward hoạt động)
    window.addEventListener('hashchange', () => {
      initDirFromHash();
      lastEtag = null;
      selectedFiles.clear();
      refresh(true);
    });

    // ─── MOCK FETCH ───────────────────────────────────────────────────────────
    async function safeFetch(path, options = {}) {
      if (isLocalPreview) {
        await new Promise(r => setTimeout(r, path.includes('upload') ? 800 : 300));
        const clientPin = options.headers?.["X-PIN"];
        if (clientPin !== "1234") return { ok: false, status: 401 };
        if (path.startsWith("/api/files")) {
          if (options.method === "DELETE") {
            const fName = decodeURIComponent(path.split("/").pop());
            mockFiles = mockFiles.filter(f => f.name !== fName);
            return { ok: true };
          }
          return { ok: true, json: async () => ({ files: mockFiles }) };
        }
        if (path.startsWith("/api/upload") && options.method === "POST") {
          for (const file of (options.body?.getAll("files") ?? [])) {
            mockFiles.unshift({ name: file.name, size: file.size, url: URL.createObjectURL(file) });
          }
          return { ok: true };
        }
        if (path === "/api/clipboard" || path.startsWith("/api/clipboard/")) {
          if (options.method === "DELETE") {
            const delId = path.split('/').pop();
            mockClipboard = mockClipboard.filter(i => String(i.id) !== String(delId));
            return { ok: true, json: async () => ({ ok: true }) };
          }
          if (options.method === "POST") {
            const newItem = { id: Date.now(), text: JSON.parse(options.body).text, timestamp: Date.now() };
            mockClipboard.unshift(newItem);
            return { ok: true, json: async () => ({ item: newItem }) };
          }
          return { ok: true, json: async () => ({ ok: true, history: mockClipboard }) };
        }
        return { ok: false };
      }
      return fetch(path, options);
    }

    // ─── TOAST UI (Thay cho Status bar cũ) ────────────────────────────────────
    function showStatus(text, type = 'loading') {
      const container = $("toast-container");
      const toast = $("toast");
      const icon = $("toast-icon");
      const msg = $("toast-msg");

      clearTimeout(_toastTimer);

      if (!text) {
        container.classList.add('hidden');
        toast.classList.remove('toast-enter');
        return;
      }

      container.classList.remove('hidden');
      toast.classList.remove('bg-slate-900', 'bg-red-900/30', 'bg-green-900/30', 'border-slate-800', 'border-red-200', 'border-green-200');
      icon.className = 'text-xl ';

      // Reset animation
      toast.classList.remove('toast-enter');
      void toast.offsetWidth; // trigger reflow
      toast.classList.add('toast-enter');

      if (type === 'loading') {
        toast.classList.add('bg-slate-900', 'border-slate-800');
        icon.classList.add('ph', 'ph-spinner', 'animate-spin', 'text-blue-500');
        msg.className = 'flex-1 truncate text-slate-300';
      } else if (type === 'error') {
        toast.classList.add('bg-red-900/30', 'border-red-200');
        icon.classList.add('ph-fill', 'ph-warning-circle', 'text-red-500');
        msg.className = 'flex-1 truncate text-red-700 font-semibold';
      } else {
        toast.classList.add('bg-green-900/30', 'border-green-200');
        icon.classList.add('ph-fill', 'ph-check-circle', 'text-green-500');
        msg.className = 'flex-1 truncate text-green-700 font-semibold';
      }

      msg.textContent = text;

      if (type !== 'loading') {
        _toastTimer = setTimeout(() => {
          container.classList.add('hidden');
          toast.classList.remove('toast-enter');
        }, 3000);
      }
    }

    // ─── HEADERS & AUTH ───────────────────────────────────────────────────────
    function getStoredPin() { return localStorage.getItem("savedPin") || ""; }

    function headers() {
      const currentInput = $("pin").value.trim();
      const pin = currentInput || getStoredPin();
      return pin ? { "X-PIN": pin } : {};
    }

    function setAuthUI(isSuccess, usedPin) {
      const pinContainer = $("pin-container");
      const btnLogout = $("btn-logout-pin");
      const pinInput = $("pin");

      if (isSuccess && usedPin) {
        localStorage.setItem("savedPin", usedPin);
        pinInput.value = "";
        pinContainer.classList.add("hidden");
        btnLogout.classList.remove("hidden");
        btnLogout.classList.add("flex");
      } else if (!isSuccess) {
        localStorage.removeItem("savedPin");
        pinContainer.classList.remove("hidden");
        btnLogout.classList.add("hidden");
        btnLogout.classList.remove("flex");
      }
    }

    function logoutPin() {
      localStorage.removeItem("savedPin");
      $("pin-container").classList.remove("hidden");
      $("btn-logout-pin").classList.add("hidden");
      $("btn-logout-pin").classList.remove("flex");
      $("pin").focus();

      $("list").innerHTML = `
        <div class="px-6 py-20 text-center flex flex-col items-center">
          <div class="w-20 h-20 bg-slate-800 rounded-full flex items-center justify-center mb-4">
            <i class="ph-fill ph-lock-key text-4xl text-slate-300"></i>
          </div>
          <p class="font-bold text-slate-300 text-lg">Đã khóa bảo mật</p>
          <p class="text-sm text-slate-400 mt-1">Nhập mã PIN để truy cập dữ liệu</p>
        </div>`;
      $("file-count").textContent = "0";
      currentFiles = [];
      updateSelectionUI();
    }

    // ─── FORMAT ───────────────────────────────────────────────────────────────
    function fmt(bytes) {
      const u = ["B", "KB", "MB", "GB"]; let i = 0, n = bytes;
      while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
      return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
    }

    const _fpGroups = [
      ['ph-file-pdf text-red-500 bg-red-900/30', 'pdf'],
      ['ph-file-doc text-blue-400 bg-blue-900/30', 'doc,docx'],
      ['ph-file-xls text-green-600 bg-green-900/30', 'xls,xlsx'],
      ['ph-file-csv text-green-600 bg-green-900/30', 'csv'],
      ['ph-file-ppt text-orange-600 bg-orange-900/30', 'ppt,pptx'],
      ['ph-file-text text-slate-400 bg-slate-800', 'txt'],
      ['ph-image text-purple-500 bg-purple-900/30', 'png,jpg,jpeg,webp,gif,svg,bmp,ico'],
      ['ph-file-archive text-orange-500 bg-orange-900/30', 'zip,rar,7z,tar,gz'],
      ['ph-file-video text-pink-500 bg-pink-900/30', 'mp4,webm,avi,mov,mkv'],
      ['ph-file-audio text-yellow-600 bg-yellow-900/30', 'mp3,wav,ogg,flac,aac,m4a'],
    ];
    const _fpMap = {};
    for (const [info, exts] of _fpGroups) {
      const [icon, color, bg] = info.split(' ');
      for (const e of exts.split(',')) _fpMap[e] = { icon, color, bg };
    }
    function fileProps(filename) {
      const ext = (filename.split('.').pop() || '').toLowerCase();
      return _fpMap[ext] || { icon: 'ph-file', color: 'text-slate-400', bg: 'bg-slate-800' };
    }

    // ─── FILE CATEGORY GROUPING ──────────────────────────────────────────
    const _s = s => new Set(s.split(','));
    const FILE_CATEGORIES = [
      { key: 'images', label: 'Hình ảnh', icon: 'ph-image', color: 'text-purple-500', bg: 'bg-purple-900/30', badgeBg: 'bg-purple-100', badgeText: 'text-purple-700', exts: _s('png,jpg,jpeg,webp,gif,svg,bmp,ico,tiff,tif') },
      { key: 'documents', label: 'Tài liệu', icon: 'ph-file-text', color: 'text-blue-400', bg: 'bg-blue-900/30', badgeBg: 'bg-blue-100', badgeText: 'text-blue-700', exts: _s('pdf,doc,docx,xls,xlsx,ppt,pptx,txt,csv,rtf,odt,ods,json,xml,html,css,js,md') },
      { key: 'videos', label: 'Video', icon: 'ph-file-video', color: 'text-pink-500', bg: 'bg-pink-900/30', badgeBg: 'bg-pink-100', badgeText: 'text-pink-700', exts: _s('mp4,webm,avi,mov,mkv,flv,wmv,3gp') },
      { key: 'audio', label: 'Âm thanh', icon: 'ph-file-audio', color: 'text-yellow-600', bg: 'bg-yellow-900/30', badgeBg: 'bg-yellow-100', badgeText: 'text-yellow-700', exts: _s('mp3,wav,ogg,flac,aac,wma,m4a,opus') },
      { key: 'archives', label: 'Nén / Archive', icon: 'ph-file-archive', color: 'text-orange-500', bg: 'bg-orange-900/30', badgeBg: 'bg-orange-100', badgeText: 'text-orange-700', exts: _s('zip,rar,7z,tar,gz,bz2,xz,iso') },
      { key: 'other', label: 'Khác', icon: 'ph-file', color: 'text-slate-400', bg: 'bg-slate-800', badgeBg: 'bg-slate-700/50', badgeText: 'text-slate-400', exts: null }
    ];

    // Trạng thái collapse cho mỗi nhóm (mặc định mở)
    const groupCollapsed = {};

    function getFileCategory(filename) {
      const ext = (filename.split('.').pop() || '').toLowerCase();
      for (const cat of FILE_CATEGORIES) {
        if (cat.exts && cat.exts.has(ext)) return cat;
      }
      return FILE_CATEGORIES[FILE_CATEGORIES.length - 1]; // 'other'
    }

    function toggleGroup(key) {
      groupCollapsed[key] = !groupCollapsed[key];
      const section = document.querySelector(`[data-group="${key}"]`);
      if (section) section.classList.toggle('group-collapsed', !!groupCollapsed[key]);
    }

    // ─── SELECTION UI ─────────────────────────────────────────────────
    function updateSelectionUI() {
      const hasSelected = selectedFiles.size > 0;

      // Toolbar bulk actions
      if (hasSelected) {
        $("table-actions").classList.remove("hidden");
        $("table-actions").classList.add("flex");
        $("selected-count").textContent = selectedFiles.size;
      } else {
        $("table-actions").classList.add("hidden");
        $("table-actions").classList.remove("flex");
      }

      // Desktop: select-all checkbox
      const cbAll = $("cb-select-all");
      if (cbAll) cbAll.checked = currentFiles.length > 0 && selectedFiles.size === currentFiles.length;

      // Update every rendered row: desktop checkbox + mobile circle
      document.querySelectorAll('.file-row[data-enc]').forEach(row => {
        const enc = row.dataset.enc;
        const isChecked = selectedFiles.has(enc);

        // Row highlight
        if (isChecked) row.classList.add('bg-blue-900/20');
        else row.classList.remove('bg-blue-900/20');

        // Desktop checkbox
        const cb = row.querySelector('.file-cb');
        if (cb) cb.checked = isChecked;

        // Mobile circle indicator
        const circle = row.querySelector('.mobile-circle');
        if (circle) {
          if (isChecked) {
            circle.className = 'mobile-circle w-6 h-6 rounded-full border-2 border-blue-500 bg-blue-900/300 flex items-center justify-center transition-all';
            circle.innerHTML = '<i class="ph-bold ph-check text-white text-xs"></i>';
          } else {
            circle.className = 'mobile-circle w-6 h-6 rounded-full border-2 border-slate-600/50 bg-slate-900 flex items-center justify-center transition-all';
            circle.innerHTML = '';
          }
        }
      });
    }

    function toggleSelect(encName, event) {
      if (event) event.stopPropagation();
      selectedFiles.has(encName) ? selectedFiles.delete(encName) : selectedFiles.add(encName);
      updateSelectionUI();
    }

    function toggleSelectAll() {
      if (selectedFiles.size === currentFiles.length && currentFiles.length > 0) {
        selectedFiles.clear();
      } else {
        currentFiles.forEach(f => selectedFiles.add(encodeURIComponent(f.name.normalize("NFC"))));
      }
      updateSelectionUI();
    }

    // ─── BUILD FILE ROW ──────────────────────────────────────────
    function buildRow(f) {
      const fileName = f.name.normalize("NFC");
      const props = fileProps(fileName);
      const encName = encodeURIComponent(fileName);
      const isChecked = selectedFiles.has(encName);
      const dirParam = currentDir ? `?dir=${encodeURIComponent(currentDir)}` : '';

      const div = document.createElement("div");
      div.dataset.enc = encName;
      div.className = `file-row group flex items-center p-3 md:px-6 md:py-4 hover:bg-slate-800/40 cursor-pointer transition-colors border-b border-slate-800/50 last:border-0 ${isChecked ? 'bg-blue-900/20' : ''}`;

      // Mobile: tap row = toggle select. Desktop: tap row = preview.
      div.onclick = (e) => {
        if (e.target.closest('button') || e.target.closest('a') || e.target.closest('input')) return;
        if (window.innerWidth < 768) {
          toggleSelect(encName, e);
        } else {
          openPreviewModal(encName, fileName);
        }
      };

      div.innerHTML = `
        <!-- Checkbox (Desktop) -->
        <div class="hidden md:flex w-10 justify-center shrink-0">
          <input type="checkbox" class="file-cb w-4 h-4 rounded border-slate-600/50 text-blue-400 focus:ring-blue-500 cursor-pointer"
            value="${encName}" ${isChecked ? 'checked' : ''} onchange="toggleSelect('${encName}', event)">
        </div>

        <!-- Icon & Info -->
        <div class="flex-1 min-w-0 flex items-center gap-3 md:px-4">
          <div class="w-12 h-12 rounded-2xl ${props.bg} flex items-center justify-center shrink-0">
            <i class="ph-fill ${props.icon} ${props.color} text-2xl"></i>
          </div>
          <div class="flex-1 min-w-0">
            <h3 class="font-semibold text-slate-200 text-sm md:text-base truncate pr-2 group-hover:text-blue-400 transition-colors">${fileName}</h3>
            <div class="flex items-center gap-2 mt-0.5 text-xs text-slate-400">
              <span class="font-medium bg-slate-800 px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider">${fileName.split('.').pop()}</span>
              <span>${fmt(f.size)}</span>
            </div>
          </div>
        </div>

        <!-- Size (Desktop) -->
        <div class="hidden md:block w-24 text-right text-slate-400 text-sm font-medium">${fmt(f.size)}</div>

        <!-- Actions -->
        <div class="flex items-center gap-1 shrink-0 ml-2 md:w-32 md:justify-center">

          <!-- Mobile: circle tick -->
          <div class="md:hidden flex items-center justify-center w-10 h-10" onclick="toggleSelect('${encName}', event)">
            <div class="mobile-circle w-6 h-6 rounded-full border-2 ${isChecked ? 'border-blue-500 bg-blue-900/300' : 'border-slate-600/50 bg-slate-900'} flex items-center justify-center transition-all">
              ${isChecked ? '<i class="ph-bold ph-check text-white text-xs"></i>' : ''}
            </div>
          </div>

          <!-- Mobile: preview button -->
          <button class="md:hidden mobile-preview-btn flex items-center justify-center w-10 h-10 text-slate-300 active:scale-90 transition-transform"
            onclick="openPreviewModal('${encName}', '${fileName.replace(/'/g, "\\'")}')"
            title="Xem tr\u01b0\u1edbc">
            <i class="ph ph-eye text-lg"></i>
          </button>

          <!-- Desktop: delete + download -->
          <button onclick="openDeleteModal('${encName}','${fileName.replace(/'/g, "\\'")}')" class="hidden md:flex w-9 h-9 items-center justify-center rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-900/30 transition-colors" title="X\u00f3a">
            <i class="ph-fill ph-trash text-lg"></i>
          </button>
          <a href="/download/${encName}${dirParam}" download="${fileName}" onclick="event.stopPropagation()" class="hidden md:flex w-9 h-9 items-center justify-center rounded-xl text-slate-400 hover:text-blue-400 hover:bg-blue-900/30 transition-colors" title="T\u1ea3i xu\u1ed1ng">
            <i class="ph-bold ph-download-simple text-lg"></i>
          </a>
        </div>
      `;
      return div;
    }

    // ─── BUILD FOLDER ROW ─────────────────────────────────────────
    function buildFolderRow(folder) {
      const folderName = folder.name;
      const targetDir = currentDir ? `${currentDir}/${folderName}` : folderName;
      const sizeText = folder.totalSize > 0 ? fmt(folder.totalSize) : '';

      const div = document.createElement('div');
      div.className = 'folder-row group flex items-center p-3 md:px-6 md:py-4 hover:bg-amber-900/20 cursor-pointer transition-all border-b border-slate-800/50 last:border-0 relative';
      div.dataset.folderDir = targetDir;
      div.onclick = (e) => {
        if (e.target.closest('button')) return;
        navigateToDir(targetDir);
      };

      // Drag-and-drop into folder
      div.addEventListener('dragenter', (e) => { e.preventDefault(); e.stopPropagation(); div.classList.add('drag-over'); });
      div.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; });
      div.addEventListener('dragleave', (e) => { e.preventDefault(); e.stopPropagation(); if (!div.contains(e.relatedTarget)) div.classList.remove('drag-over'); });
      div.addEventListener('drop', (e) => {
        e.preventDefault(); e.stopPropagation();
        div.classList.remove('drag-over');
        const files = e.dataTransfer.files;
        if (files.length > 0) uploadToFolder(files, targetDir);
      });

      const iconBg = folder.itemCount > 0 ? 'bg-amber-900/30' : 'bg-slate-800/40';
      const iconColor = folder.itemCount > 0 ? 'text-amber-500' : 'text-slate-300';
      let metaBadges = '<span class="folder-meta-badge bg-amber-900/30 text-amber-400"><i class="ph ph-stack text-xs"></i> ' + folder.itemCount + ' m\u1ee5c</span>';
      if (folder.fileCount > 0) metaBadges += '<span class="folder-meta-badge bg-blue-900/30 text-blue-500"><i class="ph ph-file text-xs"></i> ' + folder.fileCount + '</span>';
      if (folder.folderCount > 0) metaBadges += '<span class="folder-meta-badge bg-purple-900/30 text-purple-500"><i class="ph ph-folder text-xs"></i> ' + folder.folderCount + '</span>';

      div.innerHTML = '<div class="hidden md:flex w-10 justify-center shrink-0"></div>' +
        '<div class="flex-1 min-w-0 flex items-center gap-3 md:px-4">' +
        '<div class="w-12 h-12 rounded-2xl ' + iconBg + ' flex items-center justify-center shrink-0 transition-colors group-hover:bg-amber-900/40">' +
        '<i class="ph-fill ph-folder ' + iconColor + ' text-2xl"></i>' +
        '</div>' +
        '<div class="flex-1 min-w-0">' +
        '<h3 class="font-semibold text-slate-200 text-sm md:text-base truncate pr-2 group-hover:text-amber-400 transition-colors">' + folderName + '</h3>' +
        '<div class="folder-meta mt-0.5">' + metaBadges + '</div>' +
        '</div>' +
        '</div>' +
        '<div class="hidden md:block w-24 text-right text-slate-400 text-sm font-medium">' + (sizeText || '\u2014') + '</div>' +
        '<div class="flex items-center gap-1 shrink-0 ml-2 md:w-32 md:justify-center">' +
        '<button onclick="event.stopPropagation(); deleteFolder(\'' + folderName.replace(/'/g, "\\'") + '\')" class="w-9 h-9 flex items-center justify-center rounded-xl text-slate-300 hover:text-red-600 hover:bg-red-900/30 transition-colors" title="X\u00f3a th\u01b0 m\u1ee5c"><i class="ph ph-trash text-lg"></i></button>' +
        '<div class="w-9 h-9 flex items-center justify-center text-slate-300 group-hover:text-amber-500 transition-colors"><i class="ph ph-caret-right text-lg"></i></div>' +
        '</div>' +
        '<div class="folder-drop-hint hidden absolute inset-0 bg-amber-400/10 rounded-lg items-center justify-center pointer-events-none">' +
        '<span class="text-amber-400 text-xs font-bold flex items-center gap-1"><i class="ph ph-upload-simple"></i> Th\u1ea3 file v\u00e0o \u0111\u00e2y</span>' +
        '</div>';
      return div;
    }



    // ─── SEARCH / SORT / FILTER ──────────────────────────────────────
    let currentSearchTerm = '';
    let currentSortMode = 'date-desc';
    let _searchTimer = null;

    function handleSearchInput() {
      clearTimeout(_searchTimer);
      const input = $('search-input');
      const clearBtn = $('search-clear');
      currentSearchTerm = input.value.trim().toLowerCase();
      clearBtn.classList.toggle('visible', input.value.length > 0);
      _searchTimer = setTimeout(() => {
        renderFiles(currentFiles, currentFolders);
      }, 150);
    }

    function clearSearch() {
      $('search-input').value = '';
      currentSearchTerm = '';
      $('search-clear').classList.remove('visible');
      renderFiles(currentFiles, currentFolders);
    }

    function toggleSortMenu(e) {
      e.stopPropagation();
      const menu = $('sort-menu');
      menu.classList.toggle('open');
      // Close on outside click
      if (menu.classList.contains('open')) {
        setTimeout(() => {
          document.addEventListener('click', closeSortMenu, { once: true });
        }, 0);
      }
    }

    function closeSortMenu() {
      $('sort-menu').classList.remove('open');
    }

    function setSort(mode) {
      currentSortMode = mode;
      closeSortMenu();
      // Update active state
      document.querySelectorAll('#sort-menu button').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.sort === mode);
      });
      // Update label
      const labels = {
        'date-desc': 'Mới nhất', 'date-asc': 'Cũ nhất',
        'name-asc': 'Tên A→Z', 'name-desc': 'Tên Z→A',
        'size-desc': 'Lớn nhất', 'size-asc': 'Nhỏ nhất'
      };
      $('sort-label').textContent = labels[mode] || mode;
      renderFiles(currentFiles, currentFolders);
    }

    function sortFiles(files) {
      const sorted = [...files];
      switch (currentSortMode) {
        case 'date-desc': sorted.sort((a, b) => (b.mtime || 0) - (a.mtime || 0)); break;
        case 'date-asc': sorted.sort((a, b) => (a.mtime || 0) - (b.mtime || 0)); break;
        case 'name-asc': sorted.sort((a, b) => a.name.localeCompare(b.name)); break;
        case 'name-desc': sorted.sort((a, b) => b.name.localeCompare(a.name)); break;
        case 'size-desc': sorted.sort((a, b) => (b.size || 0) - (a.size || 0)); break;
        case 'size-asc': sorted.sort((a, b) => (a.size || 0) - (b.size || 0)); break;
      }
      return sorted;
    }

    // ─── SHARED UPLOAD ────────────────────────────────────────────────────
    async function doUpload(fileList, targetDir, inputEl) {
      const fd = new FormData();
      for (const f of fileList) fd.append('files', new File([f], f.name.normalize('NFC'), { type: f.type }));

      const dirLabel = targetDir || 'thư mục gốc';
      showStatus(`Đang tải ${fileList.length} file vào ${dirLabel}...`, 'loading');
      try {
        const pinVal = headers()['X-PIN'] || '';
        const params = new URLSearchParams();
        if (pinVal) params.set('pin', pinVal);
        if (targetDir) params.set('dir', targetDir);
        const qs = params.toString();
        const res = await safeFetch(`/api/upload${qs ? '?' + qs : ''}`, { method: 'POST', body: fd, headers: headers() });
        if (!res.ok) showStatus('Lỗi tải lên', 'error');
        else {
          showStatus(`Đã tải lên ${fileList.length} file thành công!`, 'success');
          if (inputEl) inputEl.value = '';
          lastEtag = null;
          refresh(true);
        }
      } catch (e) {
        showStatus('Mất kết nối', 'error');
      }
    }
    function uploadToFolder(fileList, targetDir) { return doUpload(fileList, targetDir); }

    function renderFiles(files, folders = []) {
      const tb = $("list");

      // Apply search filter
      let filteredFolders = folders;
      let filteredFiles = files;
      if (currentSearchTerm) {
        filteredFolders = folders.filter(f => f.name.toLowerCase().includes(currentSearchTerm));
        filteredFiles = files.filter(f => f.name.toLowerCase().includes(currentSearchTerm));
      }

      // Apply sorting to files
      filteredFiles = sortFiles(filteredFiles);

      // Sort folders by name (or totalSize if sorting by size)
      if (currentSortMode === 'size-desc') {
        filteredFolders = [...filteredFolders].sort((a, b) => (b.totalSize || 0) - (a.totalSize || 0));
      } else if (currentSortMode === 'size-asc') {
        filteredFolders = [...filteredFolders].sort((a, b) => (a.totalSize || 0) - (b.totalSize || 0));
      } else if (currentSortMode === 'name-desc') {
        filteredFolders = [...filteredFolders].sort((a, b) => b.name.localeCompare(a.name));
      }

      if (files.length === 0 && folders.length === 0) {
        tb.innerHTML = `
        <div class="px-6 py-24 text-center flex flex-col items-center">
          <div class="w-24 h-24 bg-blue-900/30 rounded-full flex items-center justify-center mb-4">
            <i class="ph-fill ph-folder-open text-5xl text-blue-200"></i>
          </div>
          <p class="font-bold text-slate-300 text-lg">Th\u01b0 m\u1ee5c tr\u1ed1ng</p>
          <p class="text-sm text-slate-400 mt-1">B\u1ea5m n\u00fat (+) ho\u1eb7c t\u1ea1o th\u01b0 m\u1ee5c \u0111\u1ec3 b\u1eaft \u0111\u1ea7u</p>
        </div>`;
        return;
      }

      // Search yielded no results
      if (currentSearchTerm && filteredFiles.length === 0 && filteredFolders.length === 0) {
        tb.innerHTML = `
        <div class="no-results">
          <i class="ph ph-magnifying-glass"></i>
          <p>Kh\u00f4ng t\u00ecm th\u1ea5y k\u1ebft qu\u1ea3</p>
          <span>Th\u1eed t\u00ecm v\u1edbi t\u1eeb kh\u00f3a kh\u00e1c</span>
        </div>`;
        return;
      }

      const frag = document.createDocumentFragment();

      // Render folders first
      if (filteredFolders.length > 0) {
        for (const folder of filteredFolders) {
          frag.appendChild(buildFolderRow(folder));
        }
      }

      // Group files by category
      if (filteredFiles.length > 0) {
        const groups = new Map();
        for (const cat of FILE_CATEGORIES) groups.set(cat.key, []);
        for (const f of filteredFiles) {
          const cat = getFileCategory(f.name);
          groups.get(cat.key).push(f);
        }

        for (const cat of FILE_CATEGORIES) {
          const groupFiles = groups.get(cat.key);
          if (groupFiles.length === 0) continue;

          const totalSize = groupFiles.reduce((s, f) => s + (f.size || 0), 0);
          const isCollapsed = !!groupCollapsed[cat.key];

          const section = document.createElement('div');
          section.dataset.group = cat.key;
          section.className = isCollapsed ? 'group-collapsed' : '';

          const header = document.createElement('div');
          header.className = 'group-header group hover:bg-slate-800/40 transition-colors';
          header.onclick = () => toggleGroup(cat.key);
          header.innerHTML = `
            <div class="hidden md:flex w-10 justify-center shrink-0">
              <i class="group-chevron ph-bold ph-caret-down text-lg text-slate-400 group-hover:text-blue-500 transition-colors"></i>
            </div>
            <div class="flex-1 min-w-0 flex items-center gap-3 md:px-4">
              <i class="md:hidden group-chevron ph-bold ph-caret-down text-lg text-slate-400 group-hover:text-blue-500 transition-colors"></i>
              <div class="w-12 h-12 rounded-2xl ${cat.bg} border border-[#ffffffaa] flex items-center justify-center shrink-0">
                <i class="ph-fill ${cat.icon} ${cat.color} text-2xl"></i>
              </div>
              <div class="flex items-center gap-2">
                <span class="font-bold text-slate-300 md:text-base group-hover:text-blue-400 transition-colors">${cat.label}</span>
                <span class="text-[10px] font-bold ${cat.badgeBg} ${cat.badgeText} px-2 py-0.5 rounded-md">${groupFiles.length}</span>
              </div>
            </div>
            <div class="hidden md:block w-24 text-right text-slate-400 text-sm font-semibold">${fmt(totalSize)}</div>
            <div class="flex items-center gap-1 shrink-0 ml-2 md:w-32 md:justify-center"></div>
          `;
          section.appendChild(header);

          const body = document.createElement('div');
          body.className = 'group-body';
          for (const f of groupFiles) body.appendChild(buildRow(f));
          section.appendChild(body);

          frag.appendChild(section);
        }
      }

      tb.innerHTML = '';
      tb.appendChild(frag);
    }


    // ─── REFRESH ─────────────────────────────────────────────────────────────
    function debouncedRefresh() { clearTimeout(_refreshTimer); _refreshTimer = setTimeout(() => refresh(), 300); }

    async function refresh(force = false) {
      try {
        const reqHeaders = { ...headers() };
        const sentPin = reqHeaders["X-PIN"] || "";
        if (lastEtag && !force) reqHeaders["If-None-Match"] = lastEtag;

        const dirParam = currentDir ? `?dir=${encodeURIComponent(currentDir)}` : '';
        const res = await safeFetch(`/api/files${dirParam}`, { headers: reqHeaders });
        if (res.status === 304) return;

        if (!res.ok) {
          setAuthUI(false);
          logoutPin();
          return;
        }

        setAuthUI(true, sentPin);
        const etag = res.headers?.get?.("ETag");
        if (etag) lastEtag = etag;

        const data = await res.json();
        currentFiles = data.files || [];
        currentFolders = data.folders || [];

        const encSet = new Set(currentFiles.map(f => encodeURIComponent(f.name.normalize("NFC"))));
        for (const enc of selectedFiles) { if (!encSet.has(enc)) selectedFiles.delete(enc); }

        $("file-count").textContent = currentFiles.length + currentFolders.length;
        updateSelectionUI();
        renderBreadcrumb();
        renderFiles(currentFiles, currentFolders);
        fetchClipboard();

      } catch (e) {
        console.error("Refresh error:", e);
      }
    }

    // ─── CLIPBOARD (Chat style UI) ───────────────────────────────────────────
    let clipboardHistory = [];

    function renderClipboardList() {
      const container = $("clipboard-list");
      if (!clipboardHistory || clipboardHistory.length === 0) {
        container.innerHTML = `<div class="text-center py-20 flex flex-col items-center opacity-50"><i class="ph-fill ph-chat-teardrop-text text-4xl mb-2"></i><span class="text-sm font-medium">Chưa có tin nhắn nào</span></div>`;
        return;
      }

      // Xếp tin nhắn cũ lên trên, mới xuống dưới (như chat)
      const sorted = [...clipboardHistory].sort((a, b) => a.timestamp - b.timestamp);

      container.innerHTML = sorted.map((item) => {
        const time = new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const escText = item.text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

        // UI Chat Bubble (Gửi từ người khác/Chung -> Xám)
        return `
          <div id="cb-item-${item.id}" class="flex flex-col items-start w-full max-w-[90%] md:max-w-[85%] self-start modal-slide-up">
            <div class="bg-slate-900 border border-slate-700 text-slate-200 px-4 py-3 rounded-2xl rounded-tl-sm shadow-sm text-sm whitespace-pre-wrap break-words w-full font-medium leading-relaxed">${escText}</div>
            <div class="flex items-center gap-3 mt-1 px-1">
              <span class="text-[10px] text-slate-400 font-medium">${time}</span>
              <button onclick="copyClipboardItem('${item.id}', this)" class="text-[10px] font-bold text-blue-500 uppercase flex items-center gap-1 active:scale-90 transition-transform"><i class="ph-bold ph-copy"></i> Copy</button>
              <button onclick="deleteClipboardItem('${item.id}', this)" class="text-[10px] font-bold text-red-400 uppercase flex items-center gap-1 active:scale-90 transition-transform hover:text-red-600"><i class="ph-bold ph-trash"></i> Xóa</button>
            </div>
          </div>
        `;
      }).join("");

      // Auto scroll to bottom
      container.scrollTop = container.scrollHeight;
    }

    async function fetchClipboard() {
      try {
        const res = await safeFetch("/api/clipboard", { headers: headers() });
        if (!res.ok) return;
        const data = await res.json();
        if (data.ok && Array.isArray(data.history)) {
          clipboardHistory = data.history;
          renderClipboardList();
        }
      } catch (e) { }
    }

    async function saveClipboard() {
      const textarea = $("shared-clipboard");
      const text = textarea.value.trim();
      if (!text) return;

      textarea.value = "";
      handleClipboardInput(); // shrink

      // Phản hồi UI tức thì (Optimistic update)
      const tempId = 'temp-' + Date.now();
      clipboardHistory.push({ id: tempId, text: text, timestamp: Date.now() });
      renderClipboardList();

      try {
        const res = await safeFetch("/api/clipboard", {
          method: "POST",
          headers: { ...headers(), "Content-Type": "application/json" },
          body: JSON.stringify({ text })
        });
        if (res.ok) {
          const data = await res.json();
          // Cập nhật ID thật từ server (cả server thật lẫn local preview)
          const item = clipboardHistory.find(i => i.id === tempId);
          if (item && data.item?.id) {
            item.id = data.item.id;
            renderClipboardList(); // Re-render để button xóa dùng đúng ID
          }
        } else {
          showStatus("Lỗi gửi tin", "error");
          clipboardHistory = clipboardHistory.filter(i => i.id !== tempId);
          renderClipboardList();
        }
      } catch (e) {
        showStatus("Lỗi kết nối", "error");
      }
    }

    async function copyClipboardItem(id, btn) {
      const item = clipboardHistory.find(x => x.id == id);
      if (!item) return;

      const originalText = btn.innerHTML;
      try {
        await navigator.clipboard.writeText(item.text);
        btn.innerHTML = `<i class="ph-bold ph-check text-green-500"></i> <span class="text-green-500">Đã chép</span>`;
      } catch (e) {
        const t = document.createElement("textarea");
        t.value = item.text;
        document.body.appendChild(t); t.select(); document.execCommand("copy"); document.body.removeChild(t);
        btn.innerHTML = `<i class="ph-bold ph-check text-green-500"></i> <span class="text-green-500">Đã chép</span>`;
      }
      setTimeout(() => { btn.innerHTML = originalText; }, 1500);
    }

    async function deleteClipboardItem(id, btn) {
      // Inline confirm: lần 1 bấm → hiện xác nhận, lần 2 → xóa thật
      if (!btn._confirming) {
        btn._confirming = true;
        const orig = btn.innerHTML;
        btn.innerHTML = '<i class="ph-bold ph-check text-red-500"></i> Chắc?';
        btn.classList.add('text-red-600');
        setTimeout(() => {
          if (btn._confirming) {
            btn._confirming = false;
            btn.innerHTML = orig;
            btn.classList.remove('text-red-600');
          }
        }, 2500);
        return;
      }
      btn._confirming = false;

      try {
        const res = await safeFetch(`/api/clipboard/${id}`, { method: 'DELETE', headers: headers() });
        if (res.ok) {
          clipboardHistory = clipboardHistory.filter(x => String(x.id) !== String(id));
          const el = $(`cb-item-${id}`);
          if (el) {
            el.style.transition = 'opacity 0.2s, transform 0.2s';
            el.style.opacity = '0';
            el.style.transform = 'translateX(-20px)';
            setTimeout(() => el.remove(), 220);
          } else {
            renderClipboardList();
          }
        } else {
          showStatus('Không thể xóa', 'error');
        }
      } catch (e) {
        showStatus('Lỗi kết nối', 'error');
      }
    }

    function handleClipboardKeydown(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        saveClipboard();
      }
    }

    function handleClipboardInput() {
      const el = $("shared-clipboard");
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 120) + "px";
    }

    // ─── UPLOAD (delegates to shared doUpload) ────────────────────────────
    function upload(inputEl) {
      const files = inputEl.files;
      if (!files?.length) return;
      return doUpload(files, currentDir, inputEl);
    }

    // ─── MODALS PREVIEW & DELETE ──────────────────────────────────────────────
    function openPreviewModal(encName, fileName) {
      $("preview-title").textContent = fileName;

      const modal = $("preview-modal");
      modal.classList.remove("hidden");
      // Kích hoạt animation
      setTimeout(() => { modal.classList.remove("opacity-0"); }, 10);

      const dirParam = currentDir ? `?dir=${encodeURIComponent(currentDir)}` : '';
      $("preview-download-btn").href = `/download/${encName}${dirParam}`;
      $("preview-download-btn").download = fileName;

      const pb = $("preview-body");
      pb.innerHTML = '<i class="ph ph-spinner animate-spin text-4xl text-blue-500"></i>';

      let actualUrl = `/download/${encName}${dirParam ? dirParam + '&' : '?'}preview=1`;
      const pin = headers()["X-PIN"] || "";
      if (pin) actualUrl += `&pin=${encodeURIComponent(pin)}`;

      if (isLocalPreview) {
        const mockF = mockFiles.find(f => encodeURIComponent(f.name.normalize("NFC")) === encName);
        if (mockF?.url) actualUrl = mockF.url;
        else { pb.innerHTML = '<p class="text-slate-400 font-medium">Không thể xem trước tệp ảo</p>'; return; }
      }

      const ext = fileName.split('.').pop().toLowerCase();
      const imageExts = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp', 'ico', 'avif'];
      const videoExts = ['mp4', 'webm', 'mov', 'ogg', '3gp'];
      const audioExts = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'opus', 'wma'];
      const textExts = ['txt', 'json', 'js', 'ts', 'jsx', 'tsx', 'css', 'html', 'htm', 'xml', 'csv', 'log', 'md', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'sh', 'bat', 'ps1', 'py', 'rb', 'java', 'c', 'cpp', 'h', 'go', 'rs', 'sql', 'env', 'gitignore', 'dockerfile'];

      if (imageExts.includes(ext)) {
        pb.innerHTML = `<img src="${actualUrl}" class="max-w-full max-h-full object-contain md:rounded-xl shadow-sm" onerror="this.parentElement.innerHTML='<p class=\\'text-slate-400 font-medium\\'>Không thể tải ảnh</p>'" />`;
      } else if (videoExts.includes(ext)) {
        pb.innerHTML = `<video src="${actualUrl}" controls autoplay class="w-full max-h-full bg-black md:rounded-xl"></video>`;
      } else if (audioExts.includes(ext)) {
        pb.innerHTML = `
          <div class="text-center p-8 bg-slate-900 rounded-3xl shadow-sm max-w-sm w-full">
            <div class="w-24 h-24 bg-yellow-900/30 rounded-full flex items-center justify-center mx-auto mb-5">
              <i class="ph-fill ph-music-notes text-5xl text-yellow-500"></i>
            </div>
            <p class="font-bold text-slate-200 text-lg mb-4">${fileName}</p>
            <audio src="${actualUrl}" controls autoplay class="w-full"></audio>
          </div>`;
      } else if (ext === 'pdf') {
        pb.innerHTML = `<iframe src="${actualUrl}" class="w-full h-full border-0 bg-slate-900 md:rounded-xl"></iframe>`;
      } else if (['doc', 'docx'].includes(ext)) {
        // Word preview via mammoth.js
        pb.innerHTML = '<i class="ph ph-spinner animate-spin text-4xl text-blue-500"></i>';
        fetch(actualUrl)
          .then(r => { if (!r.ok) throw new Error('Fetch failed'); return r.arrayBuffer(); })
          .then(buf => mammoth.convertToHtml({ arrayBuffer: buf }))
          .then(result => {
            pb.innerHTML = `
              <div class="w-full h-full overflow-auto bg-slate-900 md:rounded-xl">
                <div class="p-6 md:p-10 max-w-4xl mx-auto prose prose-slate prose-sm md:prose-base" style="font-family:'Times New Roman',serif;line-height:1.8">${result.value}</div>
              </div>`;
          })
          .catch(() => {
            pb.innerHTML = `
              <div class="text-center p-6 bg-slate-900 rounded-3xl shadow-sm max-w-sm w-full">
                <div class="w-20 h-20 bg-blue-900/30 rounded-full flex items-center justify-center mx-auto mb-4"><i class="ph-fill ph-file-doc text-4xl text-blue-500"></i></div>
                <p class="font-bold text-slate-200 text-lg mb-1">Không thể xem trước</p>
                <p class="text-sm text-slate-400 mb-6">Tải về để mở bằng MS Word hoặc WPS.</p>
                <a href="${actualUrl}" class="block w-full py-3 bg-blue-600 text-white font-bold rounded-xl active:scale-95 transition-transform">Tải xuống ngay</a>
              </div>`;
          });
      } else if (['xls', 'xlsx'].includes(ext)) {
        // Excel preview via SheetJS
        pb.innerHTML = '<i class="ph ph-spinner animate-spin text-4xl text-blue-500"></i>';
        fetch(actualUrl)
          .then(r => { if (!r.ok) throw new Error('Fetch failed'); return r.arrayBuffer(); })
          .then(buf => {
            const wb = XLSX.read(buf, { type: 'array' });
            let tabsHtml = '';
            let sheetsHtml = '';
            wb.SheetNames.forEach((name, idx) => {
              tabsHtml += `<button onclick="document.querySelectorAll('.xl-sheet').forEach(s=>s.classList.add('hidden'));document.getElementById('xl-sheet-${idx}').classList.remove('hidden');this.parentElement.querySelectorAll('button').forEach(b=>{b.classList.remove('bg-green-600','text-white');b.classList.add('bg-slate-800','text-slate-400')});this.classList.remove('bg-slate-800','text-slate-400');this.classList.add('bg-green-600','text-white')" class="px-4 py-2 rounded-lg text-sm font-semibold transition-colors whitespace-nowrap ${idx === 0 ? 'bg-green-600 text-white' : 'bg-slate-800 text-slate-400'}">${name}</button>`;
              const ws = wb.Sheets[name];
              const html = XLSX.utils.sheet_to_html(ws, { editable: false });
              sheetsHtml += `<div id="xl-sheet-${idx}" class="xl-sheet ${idx > 0 ? 'hidden' : ''}">${html}</div>`;
            });
            pb.innerHTML = `
              <div class="w-full h-full overflow-auto bg-slate-900 md:rounded-xl flex flex-col">
                <div class="flex gap-2 p-3 bg-slate-800/40 border-b border-slate-700 overflow-x-auto shrink-0 hide-scrollbar">${tabsHtml}</div>
                <div class="flex-1 overflow-auto p-2 xl-preview">${sheetsHtml}</div>
              </div>`;
          })
          .catch(() => {
            pb.innerHTML = `
              <div class="text-center p-6 bg-slate-900 rounded-3xl shadow-sm max-w-sm w-full">
                <div class="w-20 h-20 bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-4"><i class="ph-fill ph-file-xls text-4xl text-green-600"></i></div>
                <p class="font-bold text-slate-200 text-lg mb-1">Không thể xem trước</p>
                <p class="text-sm text-slate-400 mb-6">Tải về để mở bằng MS Excel hoặc WPS.</p>
                <a href="${actualUrl}" class="block w-full py-3 bg-green-600 text-white font-bold rounded-xl active:scale-95 transition-transform">Tải xuống ngay</a>
              </div>`;
          });
      } else if (['ppt', 'pptx'].includes(ext)) {
        pb.innerHTML = `
          <div class="text-center p-6 bg-slate-900 rounded-3xl shadow-sm max-w-sm w-full">
            <div class="w-20 h-20 bg-orange-900/30 rounded-full flex items-center justify-center mx-auto mb-4"><i class="ph-fill ph-file-ppt text-4xl text-orange-600"></i></div>
            <p class="font-bold text-slate-200 text-lg mb-1">Bản trình chiếu</p>
            <p class="text-sm text-slate-400 mb-6">Tải về để mở bằng MS PowerPoint hoặc WPS.</p>
            <a href="${actualUrl}" class="block w-full py-3 bg-orange-900/300 text-white font-bold rounded-xl active:scale-95 transition-transform">Tải xuống ngay</a>
          </div>`;
      } else if (textExts.includes(ext)) {
        pb.innerHTML = '<i class="ph ph-spinner animate-spin text-4xl text-blue-500"></i>';
        fetch(actualUrl)
          .then(r => { if (!r.ok) throw new Error('Fetch failed'); return r.text(); })
          .then(text => {
            const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            pb.innerHTML = `
              <div class="w-full h-full overflow-auto bg-slate-900 md:rounded-xl">
                <pre class="p-4 md:p-6 text-sm font-mono text-slate-200 whitespace-pre-wrap break-words leading-relaxed"><code>${escaped}</code></pre>
              </div>`;
          })
          .catch(() => {
            pb.innerHTML = '<p class="text-slate-400 font-medium">Không thể đọc nội dung tệp</p>';
          });
      } else {
        pb.innerHTML = `
          <div class="text-center p-6 bg-slate-900 rounded-3xl shadow-sm max-w-sm w-full">
            <div class="w-20 h-20 bg-slate-800/40 rounded-full flex items-center justify-center mx-auto mb-4"><i class="ph-fill ph-file-dashed text-4xl text-slate-300"></i></div>
            <p class="font-bold text-slate-200 text-lg mb-1">Không có bản xem trước</p>
            <p class="text-sm text-slate-400 mb-6">Định dạng .${ext} cần được tải về máy để xem.</p>
            <a href="${actualUrl}" class="block w-full py-3 bg-blue-600 text-white font-bold rounded-xl active:scale-95 transition-transform">Tải xuống ngay</a>
          </div>`;
      }
    }

    function closePreviewModal() {
      const modal = $("preview-modal");
      modal.classList.add("opacity-0");
      setTimeout(() => { modal.classList.add("hidden"); $("preview-body").innerHTML = ""; }, 300);
    }

    function _showDeleteModal(files, label) {
      _pendingFolderDelete = null;
      currentFilesToDelete = files;
      $('delete-message').textContent = 'Bạn có chắc chắn muốn xóa?';
      $('delete-filename').textContent = label;
      const modal = $('delete-modal');
      modal.classList.remove('hidden');
      setTimeout(() => modal.classList.remove('opacity-0'), 10);
    }
    function openDeleteModal(encName, fileName) { _showDeleteModal([{ encName, name: fileName }], fileName); }
    function openDeleteSelectedModal() { const f = Array.from(selectedFiles).map(e => ({ encName: e })); _showDeleteModal(f, `${f.length} tệp tin đã chọn`); }

    function closeDeleteModal() {
      const modal = $("delete-modal");
      modal.classList.add("opacity-0");
      setTimeout(() => { modal.classList.add("hidden"); }, 300);
    }

    async function executeDelete() {
      closeDeleteModal();

      // Xóa thư mục
      if (_pendingFolderDelete) {
        const { folderName, fullPath } = _pendingFolderDelete;
        _pendingFolderDelete = null;
        showStatus('Đang xóa thư mục...', 'loading');
        try {
          const res = await safeFetch(`/api/folders?dir=${encodeURIComponent(fullPath)}`, {
            method: 'DELETE',
            headers: headers()
          });
          if (res.ok) {
            showStatus('Đã xóa thư mục', 'success');
            lastEtag = null;
            refresh(true);
          } else {
            showStatus('Lỗi xóa thư mục', 'error');
          }
        } catch (e) {
          showStatus('Lỗi kết nối', 'error');
        }
        return;
      }

      // Xóa file
      if (!currentFilesToDelete.length) return;
      showStatus("Đang xóa...", "loading");

      try {
        const dirParam = currentDir ? `?dir=${encodeURIComponent(currentDir)}` : '';
        await Promise.all(currentFilesToDelete.map(f => safeFetch(`/api/files/${f.encName}${dirParam}`, { method: "DELETE", headers: headers() })));
        currentFilesToDelete.forEach(f => selectedFiles.delete(f.encName));
        showStatus("Đã xóa thành công", "success");
        lastEtag = null;
        refresh();
      } catch (e) {
        showStatus("Lỗi khi xóa", "error");
      }
    }

    async function downloadSelected() {
      const list = Array.from(selectedFiles);
      if (!list.length) return;
      showStatus(`Đang tải ${list.length} tệp...`, "loading");
      const dirParam = currentDir ? `?dir=${encodeURIComponent(currentDir)}` : '';
      let ok = 0;
      for (const encName of list) {
        try {
          // Dùng fetch+blob để đảm bảo tên file chính xác trên mọi trình duyệt
          let url = `/download/${encName}${dirParam}`;
          const pin = headers()['X-PIN'] || '';
          if (pin) url += `${dirParam ? '&' : '?'}pin=${encodeURIComponent(pin)}`;
          const res = await fetch(url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const blob = await res.blob();
          const blobUrl = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = blobUrl;
          a.download = decodeURIComponent(encName); // Tên file gốc, tiếng Việt OK
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
          URL.revokeObjectURL(blobUrl);
          ok++;
          await new Promise(r => setTimeout(r, 300));
        } catch (e) {
          console.error('Download failed:', encName, e);
        }
      }
      showStatus(ok === list.length ? `Đã tải ${ok} tệp thành công` : `Tải ${ok}/${list.length} tệp`, ok === list.length ? 'success' : 'error');
    }

    // ─── GLOBAL DRAG-DROP (upload to current directory) ─────────────────────
    (function setupGlobalDragDrop() {
      let dragCounter = 0;

      // Create overlay element
      const overlay = document.createElement('div');
      overlay.id = 'global-drop-overlay';
      overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(99,102,241,0.08);backdrop-filter:blur(4px);display:none;align-items:center;justify-content:center;pointer-events:none;transition:opacity 0.2s';
      overlay.innerHTML = '<div style="background:rgba(255,255,255,0.95);border:2px dashed #818cf8;border-radius:24px;padding:40px 60px;text-align:center;box-shadow:0 20px 60px rgba(99,102,241,0.15)">' +
        '<div style="width:64px;height:64px;background:linear-gradient(135deg,#eef2ff,#ede9fe);border-radius:16px;display:flex;align-items:center;justify-content:center;margin:0 auto 16px">' +
        '<i class="ph ph-cloud-arrow-up" style="font-size:32px;color:#6366f1"></i></div>' +
        '<p id="drop-overlay-text" style="font-size:16px;font-weight:700;color:#4338ca;margin-bottom:4px"></p>' +
        '<p style="font-size:13px;color:#94a3b8">Thả file để tải lên</p></div>';
      document.body.appendChild(overlay);

      function updateOverlayText() {
        const el = document.getElementById('drop-overlay-text');
        if (el) el.textContent = currentDir ? 'Tải vào: ' + currentDir : 'Tải vào thư mục gốc';
      }

      document.addEventListener('dragenter', (e) => {
        e.preventDefault();
        // Ignore if dragging from folder rows (they handle their own)
        if (e.target.closest && e.target.closest('.folder-row')) return;
        dragCounter++;
        if (dragCounter === 1) {
          updateOverlayText();
          overlay.style.display = 'flex';
          overlay.style.opacity = '1';
          overlay.style.pointerEvents = 'auto';
        }
      });

      document.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      });

      document.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dragCounter--;
        if (dragCounter <= 0) {
          dragCounter = 0;
          overlay.style.opacity = '0';
          setTimeout(() => { overlay.style.display = 'none'; overlay.style.pointerEvents = 'none'; }, 200);
        }
      });

      document.addEventListener('drop', (e) => {
        e.preventDefault();
        dragCounter = 0;
        overlay.style.opacity = '0';
        setTimeout(() => { overlay.style.display = 'none'; overlay.style.pointerEvents = 'none'; }, 200);

        // If dropped on a folder row, that handler takes care of it
        if (e.target.closest && e.target.closest('.folder-row')) return;

        const files = e.dataTransfer.files;
        if (files && files.length > 0) doUpload(files, currentDir);
      });
    })();

    // ─── GLOBAL PASTE UPLOAD ──────────────────────────────────────────────────
    document.addEventListener('paste', (e) => {
      // Ignore paste if user is typing in an input or textarea
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      const files = e.clipboardData?.files;
      if (files && files.length > 0) {
        e.preventDefault();
        doUpload(files, currentDir);
      }
    });

    // ─── INIT ─────────────────────────────────────────────────────────────────
    refresh();
    setInterval(() => debouncedRefresh(), 5000); // Fallback polling since SSE code was simplified for demo


    // This script contains the new DOM build functions that will replace old ones via script. 
    // It needs to be injected into the existing  block.

    // ─── OVERRIDE DOM BUILDERS FOR BENTO GRID ───
    window.buildFolderRow = function buildFolderRow(folder) {
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
    div.className = `folder-row group relative p-4 rounded-3xl bg-gradient-to-br ${colorClass} shadow-sm border border-white/50 cursor-pointer hover:shadow-md hover:-translate-y-1 transition-all duration-300 flex flex-col justify-between h-32 aspect-[4/3] sm:aspect-auto`;
  
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

    div.innerHTML = `
        <div class="flex items-start justify-between">
           <div class="w-10 h-10 rounded-2xl bg-white/70 flex items-center justify-center shadow-sm">
              <i class="ph-fill ph-folder text-xl"></i>
           </div>
           <button class="action-btn w-8 h-8 rounded-full bg-white/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white" onclick="event.stopPropagation(); openDeleteModal('${encName}', '${folder.name.replace(/'/g, "\\'")}')"><i class="ph-bold ph-trash text-red-500"></i></button>
        </div>
        <div class="mt-auto">
           <h3 class="font-bold text-sm truncate pr-2 text-slate-800 leading-tight">${folder.name}</h3>
           <span class="text-[10px] font-semibold opacity-70">${folder.count || 0} mục &bull; ${fmt(folder.totalSize)}</span>
        </div>
    `;
    return div;
};

window.buildRow = function buildRow(f) {
  const fileName = f.name.normalize("NFC");
  const props = fileProps(fileName); // existing function returns config {bg, icon, color}
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

  div.innerHTML = `
    <div class="flex items-start justify-between absolute top-3 right-3 z-10 w-full px-6 flex-row-reverse">
       
       <button onclick="event.stopPropagation(); toggleSelect('${encName}')" class="action-btn w-6 h-6 rounded-full ${isChecked ? 'bg-blue-500 border-none' : 'bg-transparent border-2 border-slate-200'} flex items-center justify-center transition-colors">
          ${isChecked ? '<i class="ph-bold ph-check text-white text-[10px]"></i>' : ''}
       </button>
    </div>
    
    <div class="w-12 h-12 rounded-2xl ${props.bg.replace('bg-', 'bg-').replace('-50', '-100')} flex items-center justify-center mb-3 mt-1 shadow-inner shrink-0 relative">
      <i class="ph-fill ${props.icon} ${props.color} text-2xl"></i>
    </div>
    
    <div class="mt-auto">
       <h3 class="font-bold text-sm text-slate-700 line-clamp-2 leading-snug break-all group-hover:text-blue-600 transition-colors">${fileName}</h3>
       <div class="flex items-center justify-between mt-2">
         <span class="text-[10px] font-bold text-slate-400 bg-slate-50 px-2 py-0.5 rounded-lg border border-slate-100">${fmt(f.size)}</span>
         <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <a href="/download/${encName}${dirParam}" download="${fileName}" class="action-btn w-7 h-7 bg-slate-50 hover:bg-slate-100 rounded-full flex items-center justify-center text-slate-500 hover:text-blue-600 transition-all" onclick="event.stopPropagation()">
               <i class="ph-bold ph-download-simple"></i>
            </a>
            <button class="action-btn w-7 h-7 bg-slate-50 hover:bg-slate-100 rounded-full flex items-center justify-center text-slate-500 hover:text-red-500 transition-all" onclick="event.stopPropagation(); openDeleteModal('${encName}', '${fileName.replace(/'/g, "\\\\'")}')">
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
    if(navF && navC) {
        if(isFiles) {
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

  