/* ========== 全局状态 ========== */
let sheetImages = []; // 将存储乐谱的 URL 数组
let currentPage = 0;
let flipCooldown = false;
let headTurnCooldown = false;
const HEAD_TURN_COOLDOWN_MS = 1500;
const YAW_THRESHOLD = 15;

// ****** Cloudinary 配置 ******
const CLOUDINARY_CLOUD_NAME = "dje3ekclp"; 
const CLOUDINARY_UPLOAD_PRESET = "my_unsigned_upload"; 

// 存储乐谱URL到Local Storage的键名
const LOCAL_STORAGE_SHEETS_KEY = 'pianoSheetUrls';


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

    // ****** 从 Local Storage 加载之前上传的乐谱 ******
    loadSheetsFromLocalStorage();

    // ****** 新增：绑定上下翻页按钮事件 ******
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
  document.getElementById('sheetInput')
          .addEventListener('change', handleFileUpload);

  /* ---------- Cloudinary & Local Storage 相关的辅助函数 ---------- */

  function loadSheetsFromLocalStorage() {
    console.log('正在从 Local Storage 加载乐谱...');
    const storedUrls = localStorage.getItem(LOCAL_STORAGE_SHEETS_KEY);
    if (storedUrls) {
      try {
        sheetImages = JSON.parse(storedUrls);
        currentPage = 0;
        showPage(); // 显示加载后的第一页乐谱
        updatePageNavigation(); // 加载后更新页码导航
      } catch (e) {
        console.error('解析 Local Storage 中的乐谱 URL 失败:', e);
        sheetImages = []; 
      }
    } else {
      console.log('Local Storage 中没有找到乐谱。');
    }
  }

  function saveSheetsToLocalStorage() {
    localStorage.setItem(LOCAL_STORAGE_SHEETS_KEY, JSON.stringify(sheetImages));
    console.log('乐谱已保存到 Local Storage。');
  }

  /* ---------- 其余函数（保持原有的或根据之前讨论进行更新） ---------- */
  function detectFaces() {
    // ... (此函数内容保持不变) ...
    const video = document.getElementById('video');
    const canvas = document.getElementById('overlay');
    const displaySize = { width: video.width, height: video.height };
    faceapi.matchDimensions(canvas, displaySize);

    setInterval(async () => {
      if (video.readyState !== 4) return;
      
      if (!faceapi.nets.faceLandmark68Net.isLoaded) {
          console.warn('FaceLandmark68Net 未加载，跳过地标检测相关功能。');
          return;
      }

      const detections = await faceapi
        .detectAllFaces(video, new faceapi.TinyFaceDetectorOptions())
        .withFaceLandmarks();

      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const resized = faceapi.resizeResults(detections, displaySize);
      faceapi.draw.drawFaceLandmarks(canvas, resized);

      for (const d of resized) {
        if (!d.landmarks) {
            console.warn('当前检测对象没有地标信息，跳过嘴巴和头部姿态检测。');
            continue;
        }

        const mouth = d.landmarks.getMouth();
        if (mouth && mouth.length >= 20) {
            const topLipY = averageY([
              mouth[2], mouth[3], mouth[4], mouth[13], mouth[14], mouth[15]
            ]);
            const bottomLipY = averageY([
              mouth[8], mouth[9], mouth[10], mouth[17], mouth[18], mouth[19]
            ]);
            const mouthHeight = bottomLipY - topLipY;
            if (mouthHeight > 15) {
              nextPage();
            }
        }

        if (!headTurnCooldown) {
            const leftEye = d.landmarks.getLeftEye();
            const rightEye = d.landmarks.getRightEye();
            const nose = d.landmarks.getNose();

            if (leftEye.length > 0 && rightEye.length > 0 && nose.length > 0) {
                const leftEyeCenterX = averageX(leftEye);
                const rightEyeCenterX = averageX(rightEye);
                const noseTipX = nose[0].x;

                const eyeMidPointX = (leftEyeCenterX + rightEyeCenterX) / 2;
                const yawDifference = noseTipX - eyeMidPointX;

                if (yawDifference > YAW_THRESHOLD) {
                    console.log('检测到头向左转，翻回上页！');
                    prevPage();
                    headTurnCooldown = true;
                    setTimeout(() => (headTurnCooldown = false), HEAD_TURN_COOLDOWN_MS);
                } else if (yawDifference < -YAW_THRESHOLD) {
                    console.log('检测到头向右转，翻到下页！');
                    nextPage();
                    headTurnCooldown = true;
                    setTimeout(() => (headTurnCooldown = false), HEAD_TURN_COOLDOWN_MS);
                }
            }
        }
      }
    }, 300);
  }

  function averageY(points) {
    if (!points || points.length === 0) return 0;
    return points.reduce((sum, pt) => sum + pt.y, 0) / points.length;
  }

  function averageX(points) {
    if (!points || points.length === 0) return 0;
    return points.reduce((sum, pt) => sum + pt.x, 0) / points.length;
  }

  async function handleFileUpload(e) {
    // ... (此函数内容保持不变) ...
    const files = e.target.files;
    if (!files.length) return;
    const btn = document.querySelector('.upload-btn');
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

      sheetImages = [...new Set([...sheetImages, ...uploadedUrls])];
      saveSheetsToLocalStorage(); 
      
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
    // ... (此函数内容保持不变) ...
    const img = document.getElementById('sheetDisplay');
    const topIndicator = document.getElementById('topPageIndicator'); 
    const bottomIndicator = document.getElementById('bottomPageIndicator'); 

    // 新增：获取上下翻页按钮
    const prevBtn = document.getElementById('prevPageBtn');
    const nextBtn = document.getElementById('nextPageBtn');

    if (sheetImages.length) {
      img.src = sheetImages[currentPage];
      img.style.display = 'block';
      const pageText = `Page: ${currentPage + 1}/${sheetImages.length}`;

      if (topIndicator) {
          topIndicator.textContent = pageText;
      }
      if (bottomIndicator) {
          bottomIndicator.textContent = pageText;
      }
      updatePageNavigation(); 

      // 新增：根据当前页码禁用/启用按钮
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

      // 新增：没有乐谱时禁用所有按钮
      if (prevBtn) {
          prevBtn.disabled = true;
      }
      if (nextBtn) {
          nextBtn.disabled = true;
      }
    }
  }

  function updatePageNavigation() {
    // ... (此函数内容保持不变) ...
    const pageNavContainer = document.getElementById('pageNavigation');
    pageNavContainer.innerHTML = ''; 

    if (sheetImages.length === 0) {
        // 没有乐谱时也禁用上下翻页按钮
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
    // 确保在生成页码导航后，上下翻页按钮的状态也更新
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
    if (currentPage < sheetImages.length - 1) { // 检查是否已是最后一页
        flipCooldown = true;
        currentPage++;
        showPage();
        setTimeout(() => (flipCooldown = false), 1000);
    }
  }

  function prevPage() {
    if (!sheetImages.length || flipCooldown) return;
    if (currentPage > 0) { // 检查是否已是第一页
        flipCooldown = true;
        currentPage--;
        showPage();
        setTimeout(() => (flipCooldown = false), 1000);
    }
  }

})();