/* ========== 全局状态 ========== */
let sheetImages = []; // 将存储乐谱的 URL 数组
let currentPage = 0;
let flipCooldown = false;
let headTurnCooldown = false;
const HEAD_TURN_COOLDOWN_MS = 1500;
const YAW_THRESHOLD = 15;

// ****** Cloudinary 配置 ******
const CLOUDINARY_CLOUD_NAME = "dje3ekclp"; 
const CLOUDINARY_UPLOAD_PRESET = "my_unsigned_upload"; // 仍旧使用无符号上传预设

// 存储乐谱URL到Local Storage的键名
const LOCAL_STORAGE_SHEETS_KEY = 'pianoSheetUrls';
// 本地上传乐谱的标识前缀
const LOCAL_SHEET_PREFIX = 'local_';

/* ========== 立即执行的初始化 ========== */
(async () => {
  /* 0) 检查 faceapi 是否存在 */
  if (!window.faceapi) {
    alert('face-api.min.js 没加载到，检查 libs/face-api.min.js 路径或服务器根目录');
    return;
  }
  const faceapi = window.faceapi;
  console.log('✅ faceapi 准备就绪', faceapi);

  /* 1) 显示加载动画 */
  document.getElementById('loading').style.display = 'block';

  try {
    /* 2) 加载模型 */
    const MODEL_URL = 'https://raw.githubusercontent.com/rgon006/MMM3/main/models'; 
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL)
    ]);

    console.log('✅ 模型加载完成');

    /* 3) 打开摄像头 */
    const video = document.getElementById('video');
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480 }
    });
    video.srcObject = stream;

    /* 4) 启动人脸检测循环 */
    detectFaces();

    // 从 Local Storage 加载之前上传的乐谱
    loadSheetsFromLocalStorage();

    // 绑定上下翻页按钮事件
    const prevBtn = document.getElementById('prevPageBtn');
    const nextBtn = document.getElementById('nextPageBtn');

    if (prevBtn) {
        prevBtn.addEventListener('click', prevPage);
    }
    if (nextBtn) {
        nextBtn.addEventListener('click', nextPage);
    }

  } catch (err) {
    console.error('Initialization failed:', err);
    alert(`Camera error: ${err.message}`);
    return;
  } finally {
    document.getElementById('loading').style.display = 'none';
  }

  /* 5) 绑定文件上传事件 */
  // 绑定“上传到 Cloud”按钮
  document.getElementById('uploadCloudBtn')
          .addEventListener('click', () => { // 使用箭头函数传递 event 给 handleCloudUpload
            const fileInput = document.getElementById('sheetInput');
            if (fileInput.files.length === 0) {
                alert('请选择乐谱文件进行上传！');
                return;
            }
            handleCloudUpload(fileInput.files);
          });

  // 绑定“上传到本地”按钮
  document.getElementById('uploadLocalBtn')
          .addEventListener('click', () => { // 使用箭头函数传递 event 给 handleLocalUpload
            const fileInput = document.getElementById('sheetInput');
            if (fileInput.files.length === 0) {
                alert('请选择乐谱文件进行上传！');
                return;
            }
            handleLocalUpload(fileInput.files);
          });
          

  /* ---------- Cloudinary & Local Storage 相关的辅助函数 ---------- */

  function loadSheetsFromLocalStorage() {
    console.log('正在从 Local Storage 加载乐谱...');
    const storedUrls = localStorage.getItem(LOCAL_STORAGE_SHEETS_KEY);
    if (storedUrls) {
      try {
        sheetImages = JSON.parse(storedUrls);
        // 清理可能已失效的本地 URL 对象
        sheetImages = sheetImages.filter(url => !url.startsWith(LOCAL_SHEET_PREFIX) || URL.createObjectURL); // 简单检查，但实际URL对象已失效
        currentPage = 0;
        showPage(); // 显示加载后的第一页乐谱
        updatePageNavigation(); // 加载后更新页码导航
        console.log(`✅ 从 Local Storage 加载了 ${sheetImages.length} 张乐谱。`);
      } catch (e) {
        console.error('解析 Local Storage 中的乐谱 URL 失败:', e);
        sheetImages = []; 
      }
    } else {
      console.log('Local Storage 中没有找到乐谱。');
    }
  }

  function saveSheetsToLocalStorage() {
    // 过滤掉本地 URL，因为它们在刷新后会失效，不值得存储
    const urlsToSave = sheetImages.filter(url => !url.startsWith(LOCAL_SHEET_PREFIX));
    localStorage.setItem(LOCAL_STORAGE_SHEETS_KEY, JSON.stringify(urlsToSave));
    console.log('乐谱已保存到 Local Storage (仅 Cloudinary URL)。');
  }

  /* ---------- 新增：处理本地文件上传 ---------- */
  function handleLocalUpload(files) {
    if (!files.length) return;
    const btn = document.getElementById('uploadLocalBtn');
    const originalBtnText = btn.innerHTML;
    btn.innerHTML = '<div class="spinner"></div> 加载中…';
    btn.disabled = true;

    try {
      // 撤销之前所有本地创建的 URL，防止内存泄漏
      sheetImages.forEach(u => {
        if (u.startsWith(LOCAL_SHEET_PREFIX)) {
          URL.revokeObjectURL(u.substring(LOCAL_SHEET_PREFIX.length));
        }
      });

      // 为新选择的文件创建 Blob URL，并添加前缀以区分
      const newLocalUrls = Array.from(files, f => LOCAL_SHEET_PREFIX + URL.createObjectURL(f));
      
      // 合并新加载的本地乐谱和现有的 Cloudinary 乐谱
      // 注意：这里会将本地乐谱添加到列表，但它们不会被保存到 Local Storage
      sheetImages = [...newLocalUrls, ...sheetImages.filter(url => !url.startsWith(LOCAL_SHEET_PREFIX))];

      currentPage = 0;
      showPage();
      updatePageNavigation();

      btn.innerHTML = `<span style="color:#27ae60">✓</span> 加载了 ${files.length} 张！`;
      setTimeout(() => {
        btn.innerHTML = originalBtnText;
        btn.disabled = false;
      }, 3000);

      alert('本地乐谱已加载！刷新页面后需要重新上传。');

    } catch (err) {
      console.error('加载本地乐谱失败:', err);
      btn.innerHTML = `<span style="color:#e74c3c">✗</span> 加载失败`;
      setTimeout(() => {
        btn.innerHTML = originalBtnText;
        btn.disabled = false;
      }, 3000);
      alert('加载本地乐谱失败。请检查控制台获取更多信息。');
    }
  }


  /* ---------- 修改：处理 Cloudinary 文件上传 (仍旧使用无符号上传) ---------- */
  async function handleCloudUpload(files) {
    if (!files.length) return;
    const btn = document.getElementById('uploadCloudBtn'); // 针对 Cloudinary 按钮
    const originalBtnText = btn.innerHTML; 
    btn.innerHTML = '<div class="spinner"></div> 上传中…';
    btn.disabled = true; 

    const uploadedUrls = [];

    try {
      for (const file of files) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET); 

        const uploadUrl = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;

        const response = await fetch(uploadUrl, {
          method: 'POST',
          body: formData
        });

        if (!response.ok) {
          throw new Error(`Cloudinary 上传失败: ${response.statusText}`);
        }

        const data = await response.json();
        uploadedUrls.push(data.secure_url); 
        console.log(`✅ 上传 ${file.name} 成功:`, data.secure_url);
      }

      // 将新上传的URL添加到现有乐谱列表，并去重
      // 注意：这里要确保不清除本地加载的乐谱，如果它们在当前会话中存在
      sheetImages = [...new Set([...sheetImages, ...uploadedUrls])];
      saveSheetsToLocalStorage(); // 仅保存 Cloudinary URL

      currentPage = 0;
      showPage(); 
      updatePageNavigation(); 

      btn.innerHTML = `<span style="color:#27ae60">✓</span> 上传并加载了 ${uploadedUrls.length} 张！`;
      setTimeout(() => {
          btn.innerHTML = originalBtnText;
          btn.disabled = false;
      }, 3000);

    } catch (err) {
      console.error('上传乐谱失败:', err);
      btn.innerHTML = `<span style="color:#e74c3c">✗</span> 上传失败`;
      setTimeout(() => {
          btn.innerHTML = originalBtnText;
          btn.disabled = false;
      }, 3000);
      alert('上传乐谱失败。请检查控制台获取更多信息。');
    }
  }

  function showPage() {
    const img = document.getElementById('sheetDisplay');
    const topIndicator = document.getElementById('topPageIndicator'); 
    const bottomIndicator = document.getElementById('bottomPageIndicator'); 

    const prevBtn = document.getElementById('prevPageBtn');
    const nextBtn = document.getElementById('nextPageBtn');

    if (sheetImages.length) {
      // 检查当前 URL 是否是本地文件 URL
      if (sheetImages[currentPage].startsWith(LOCAL_SHEET_PREFIX)) {
        img.src = sheetImages[currentPage].substring(LOCAL_SHEET_PREFIX.length);
      } else {
        img.src = sheetImages[currentPage];
      }
      img.style.display = 'block';
      const pageText = `Page: ${currentPage + 1}/${sheetImages.length}`;

      if (topIndicator) {
          topIndicator.textContent = pageText;
      }
      if (bottomIndicator) {
          bottomIndicator.textContent = pageText;
      }
      updatePageNavigation(); 

      if (prevBtn) {
          prevBtn.disabled = currentPage === 0;
      }
      if (nextBtn) {
          nextBtn.disabled = currentPage === sheetImages.length - 1;
      }

    } else {
      img.style.display = 'none';
      if (topIndicator) {
          topIndicator.textContent = 'No sheets loaded';
      }
      if (bottomIndicator) {
          bottomIndicator.textContent = 'No sheets loaded';
      }
      updatePageNavigation(); 

      if (prevBtn) {
          prevBtn.disabled = true;
      }
      if (nextBtn) {
          nextBtn.disabled = true;
      }
    }
  }

  function updatePageNavigation() {
    const pageNavContainer = document.getElementById('pageNavigation');
    pageNavContainer.innerHTML = ''; 

    if (sheetImages.length === 0) {
        const prevBtn = document.getElementById('prevPageBtn');
        const nextBtn = document.getElementById('nextPageBtn');
        if (prevBtn) prevBtn.disabled = true;
        if (nextBtn) nextBtn.disabled = true;
        return; 
    }

    const maxPagesToShow = 10; 
    const startPage = Math.max(0, currentPage - Math.floor(maxPagesToShow / 2));
    const endPage = Math.min(sheetImages.length - 1, startPage + maxPagesToShow - 1);

    if (startPage > 0) {
        const span = document.createElement('span');
        span.textContent = '...';
        span.classList.add('page-nav-ellipsis');
        pageNavContainer.appendChild(span);
    }

    for (let i = startPage; i <= endPage; i++) {
      const pageButton = document.createElement('button');
      pageButton.textContent = i + 1; 
      pageButton.classList.add('page-nav-button');
      if (i === currentPage) {
        pageButton.classList.add('active'); 
      }
      pageButton.addEventListener('click', () => {
        currentPage = i;
        showPage(); 
      });
      pageNavContainer.appendChild(pageButton);
    }

    if (endPage < sheetImages.length - 1) {
        const span = document.createElement('span');
        span.textContent = '...';
        span.classList.add('page-nav-ellipsis');
        pageNavContainer.appendChild(span);
    }
    const prevBtn = document.getElementById('prevPageBtn');
    const nextBtn = document.getElementById('nextPageBtn');
    if (prevBtn) {
        prevBtn.disabled = currentPage === 0;
    }
    if (nextBtn) {
        nextBtn.disabled = currentPage === sheetImages.length - 1;
    }
  }


  function nextPage() {
    if (!sheetImages.length || flipCooldown) return;
    if (currentPage < sheetImages.length - 1) { 
        flipCooldown = true;
        currentPage++;
        showPage();
        setTimeout(() => (flipCooldown = false), 1000);
    }
  }

  function prevPage() {
    if (!sheetImages.length || flipCooldown) return;
    if (currentPage > 0) { 
        flipCooldown = true;
        currentPage--;
        showPage();
        setTimeout(() => (flipCooldown = false), 1000);
    }
  }

})();