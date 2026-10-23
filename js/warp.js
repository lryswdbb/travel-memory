/* ============ 星际穿梭场景（Three.js） ============
 * 两段式：
 *   1. 穿梭动画：星场拉伸 → 星系掠过 → 地球逼近（点击/空格可跳过，直达抵达态）
 *   2. 抵达态：卫星实拍质感的地球，可拖拽旋转、滚轮缩放；
 *      点击「进入地图」或任意双击进入地图
 */
(function () {
  'use strict';

  const DUR = {          // 时间轴（毫秒）
    fadeStars: 800,
    warpStart: 600,
    warpEnd: 4200,
    decelEnd: 5600,
    earthShow: 5200,
    earthBig: 8200,
    total: 9400
  };

  let renderer, scene, camera, stars, galaxies = [], earth, glow, clock;
  let running = false, arrived = false, startTime = 0, onDone = null, raf = 0;
  let earthTextureOk = false;
  let ui = null;           // 抵达态 UI 元素引用
  let enterBtn = null;

  const STAR_COUNT = 7000, FIELD_LEN = 5000;

  // ---- 抵达态交互状态 ----
  // 地球沿用动画结束时的 scale 3.2（世界半径 160），相机从贴地拉远到全景
  const CAM_DIST = 380, CAM_MIN = 175, CAM_MAX = 1600, CAM_START = 172;
  let dragging = false, moved = 0, lastX = 0, lastY = 0;
  let velX = 0, velY = 0;          // 拖拽惯性
  let targetDist = CAM_DIST, dist = CAM_START;
  let pinchDist = 0;

  function makeGlowTexture(r, g, b) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const ctx = c.getContext('2d');
    const grd = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, `rgba(${r},${g},${b},1)`);
    grd.addColorStop(0.25, `rgba(${r},${g},${b},.6)`);
    grd.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = grd; ctx.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }

  // 大气层光晕：亮度集中在边缘一圈（中心被球体挡住，做在中心是浪费）
  function makeAtmoTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const ctx = c.getContext('2d');
    const grd = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(90,160,255,0)');
    grd.addColorStop(0.52, 'rgba(90,160,255,0)');
    grd.addColorStop(0.66, 'rgba(120,180,255,.5)');
    grd.addColorStop(0.8, 'rgba(90,150,255,.22)');
    grd.addColorStop(1, 'rgba(70,130,255,0)');
    ctx.fillStyle = grd; ctx.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }

  function makeGalaxyTexture(hue) {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const ctx = c.getContext('2d');
    ctx.translate(128, 128);
    // 核心
    let grd = ctx.createRadialGradient(0, 0, 0, 0, 0, 120);
    grd.addColorStop(0, `hsla(${hue},60%,85%,.9)`);
    grd.addColorStop(0.18, `hsla(${hue},70%,65%,.45)`);
    grd.addColorStop(1, `hsla(${hue},80%,50%,0)`);
    ctx.fillStyle = grd;
    ctx.fillRect(-128, -128, 256, 256);
    // 旋臂（多条旋转的椭圆渐变）
    ctx.globalCompositeOperation = 'lighter';
    for (let arm = 0; arm < 4; arm++) {
      ctx.save();
      ctx.rotate((arm / 4) * Math.PI * 2 + Math.random());
      ctx.scale(1, 0.32);
      grd = ctx.createRadialGradient(0, 0, 10, 0, 0, 118);
      grd.addColorStop(0, `hsla(${hue + 25},80%,75%,.35)`);
      grd.addColorStop(1, `hsla(${hue + 25},80%,60%,0)`);
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.arc(0, 0, 118, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    // 星点
    for (let i = 0; i < 160; i++) {
      const a = Math.random() * Math.PI * 2, rr = 14 + Math.pow(Math.random(), .6) * 110;
      ctx.fillStyle = `hsla(${hue + Math.random() * 60 - 30},60%,90%,${Math.random() * .7})`;
      ctx.fillRect(Math.cos(a) * rr, Math.sin(a) * rr * .45, 1.6, 1.6);
    }
    return new THREE.CanvasTexture(c);
  }

  function buildStars() {
    const pos = new Float32Array(STAR_COUNT * 3);
    const col = new Float32Array(STAR_COUNT * 3);
    const c = new THREE.Color();
    for (let i = 0; i < STAR_COUNT; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 60 + Math.pow(Math.random(), .5) * 900;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = Math.sin(a) * r;
      pos[i * 3 + 2] = -Math.random() * FIELD_LEN;
      c.setHSL(0.55 + Math.random() * 0.15, Math.random() * 0.4, 0.75 + Math.random() * 0.25);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    stars = new THREE.Points(g, new THREE.PointsMaterial({
      size: 3.4, map: makeGlowTexture(255, 255, 255), vertexColors: true,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true
    }));
    scene.add(stars);
  }

  function buildGalaxies() {
    const hues = [210, 265, 30, 190, 285, 340, 225, 45, 255, 200];
    for (let i = 0; i < 10; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: makeGalaxyTexture(hues[i]), transparent: true,
        depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.9
      }));
      const s = 260 + Math.random() * 520;
      sp.scale.set(s, s, 1);
      sp.position.set(
        (Math.random() - .5) * 1500,
        (Math.random() - .5) * 1100,
        -500 - Math.random() * (FIELD_LEN - 700)
      );
      sp.material.rotation = Math.random() * Math.PI;
      galaxies.push(sp);
      scene.add(sp);
    }
  }

  function buildEarth() {
    const geo = new THREE.SphereGeometry(50, 96, 96);
    const mat = new THREE.MeshPhongMaterial({ color: 0x2b6fd6, shininess: 12 });
    earth = new THREE.Mesh(geo, mat);
    earth.position.set(0, 0, -2600);
    earth.rotation.z = -0.41;
    scene.add(earth);

    // 大气光晕（边缘一圈蓝光，模拟卫星照片的大气散射）
    glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeAtmoTexture(), transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending, opacity: .8
    }));
    glow.scale.set(150, 150, 1);
    earth.add(glow);

    // 太阳：偏正面一点，让可见半球大部分被照亮（更像白天的卫星照片）
    const sun = new THREE.DirectionalLight(0xffffff, 1.25);
    sun.position.set(-2.2, 0.9, 4);
    scene.add(sun);
    scene.add(new THREE.AmbientLight(0x445577, 0.7));

    // 尝试加载真实贴图（file:// 下可能被浏览器安全策略拒绝，失败则用纯色地球）
    const img = new Image();
    img.onload = function () {
      try {
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        ctx.getImageData(0, 0, 1, 1); // 探测是否被污染
        const tex = new THREE.CanvasTexture(c);
        tex.encoding = THREE.sRGBEncoding; // 贴图是 sRGB，需声明，否则亮部过曝
        earth.material.map = tex;
        earth.material.color.set(0xffffff);
        // 卫星实拍质感：低高光、略提亮，避免塑料感
        earth.material.shininess = 4;
        earth.material.specular = new THREE.Color(0x0a0a0a);
        earth.material.needsUpdate = true;
        earthTextureOk = true;
      } catch (e) { /* 保持纯色地球 */ }
    };
    img.src = 'assets/earth.jpg';
  }

  function ease(t) { return t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
  function clamp01(t) { return Math.max(0, Math.min(1, t)); }

  function frame() {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    try {
      frameInner();
    } catch (e) {
      console.error('穿梭动画帧异常，直接结束：', e);
      finish();
    }
  }

  function frameInner() {
    const now = performance.now();
    const t = now - startTime;
    const dt = Math.min(clock.getDelta(), 0.05);

    // ---- 速度曲线：缓起 → 极速 → 减速
    let speed;
    if (t < DUR.warpStart) speed = 300 * clamp01(t / DUR.warpStart);
    else if (t < DUR.warpEnd) speed = 300 + 2700 * ease(clamp01((t - DUR.warpStart) / (DUR.warpEnd - DUR.warpStart)));
    else if (t < DUR.decelEnd) speed = 3000 * (1 - ease(clamp01((t - DUR.warpEnd) / (DUR.decelEnd - DUR.warpEnd)))) + 120;
    else speed = 120 * Math.max(0, 1 - (t - DUR.decelEnd) / 2500);

    // ---- 星星移动 + 高速时拉出尾迹感
    const p = stars.geometry.attributes.position;
    for (let i = 0; i < STAR_COUNT; i++) {
      let z = p.array[i * 3 + 2] + speed * dt;
      if (z > 300) {
        z -= FIELD_LEN;
        const a = Math.random() * Math.PI * 2;
        const r = 60 + Math.pow(Math.random(), .5) * 900;
        p.array[i * 3] = Math.cos(a) * r;
        p.array[i * 3 + 1] = Math.sin(a) * r;
      }
      p.array[i * 3 + 2] = z;
    }
    p.needsUpdate = true;
    stars.material.size = 3.0 + Math.min(speed / 3000, 1) * 3.5;

    // ---- 星系掠过
    for (const g of galaxies) {
      g.position.z += speed * dt * 0.92;
      g.material.rotation += dt * 0.05;
      if (g.position.z > 400) g.visible = false;
      const d = Math.abs(g.position.z);
      g.material.opacity = g.visible ? Math.min(0.9, d / 900) : 0;
    }

    // ---- 相机轻微漂移增强速度感
    camera.position.x = Math.sin(t / 900) * 24 * Math.min(1, speed / 1200);
    camera.position.y = Math.cos(t / 1100) * 18 * Math.min(1, speed / 1200);
    camera.rotation.z = Math.sin(t / 2600) * 0.03;

    // ---- 地球：出现 → 由小到大逼近
    if (t > DUR.earthShow) {
      earth.visible = true;
      const k = ease(clamp01((t - DUR.earthShow) / (DUR.earthBig - DUR.earthShow)));
      earth.position.z = -2600 + k * 2480;         // 远 → 近
      const s = 1 + k * k * 2.2;                   // 由小变大
      earth.scale.set(s, s, s);
      glow.material.opacity = 0.5 + k * 0.4;   // 光晕是地球子节点，尺寸自动跟随
      // 提示文字
      const label = document.getElementById('warp-earth-label');
      const hint = document.getElementById('warp-hint');
      if (t > DUR.earthShow + 700) { hint.style.opacity = 0; label.style.opacity = k > .35 ? 1 : 0; }
    }
    earth.rotation.y += dt * 0.12;

    // ---- 抵达：地球充满屏幕后进入可交互的卫星视角
    if (t >= DUR.total) { finish(); }
  }

  // ---- 抵达态：卫星视角循环 ----
  function arriveLoop() {
    if (!arrived) return;
    requestAnimationFrame(arriveLoop);
    const dt = Math.min(clock.getDelta(), 0.05);

    // 拖拽惯性衰减
    if (!dragging) {
      earth.rotation.y += velX;
      earth.rotation.x = clampTilt(earth.rotation.x + velY);
      velX *= 0.94; velY *= 0.94;
      // 无操作时缓慢自转，保持“活”的感觉
      if (Math.abs(velX) < 0.0004) earth.rotation.y += dt * 0.02;
    }

    // 滚轮/捏合缩放平滑逼近（抵达初期兼作“从贴地拉远到全景”的开场运镜）
    stepZoom(Math.min(1, dt * 1.1));
  }

  function clampTilt(x) { return Math.max(-1.2, Math.min(1.2, x)); }

  // 缩放推进：把相机距离朝目标缓动一步。arriveLoop 每帧调用；
  // 交互事件里也调用一次，保证即使某帧未刷新也有即时反馈。
  function stepZoom(k) {
    if (!arrived) return;
    dist += (targetDist - dist) * k;
    camera.position.set(0, 0, dist);
    const g = clamp01((dist - CAM_MIN) / (CAM_MAX - CAM_MIN));
    glow.material.opacity = 0.5 + g * 0.4;
  }

  function arrive() {
    if (arrived) return;
    arrived = true;
    running = false;
    cancelAnimationFrame(raf);

    // 地球摆到原点，保持动画结束时的尺寸；相机从贴近地表处开始，自动拉远揭示全貌
    earth.visible = true;
    earth.position.set(0, 0, 0);
    earth.scale.set(3.2, 3.2, 3.2);
    earth.rotation.set(-0.18, Math.random() * Math.PI * 2, -0.41);
    dist = CAM_START; targetDist = CAM_DIST;
    camera.position.set(0, 0, dist);
    camera.rotation.set(0, 0, 0);
    stars.visible = true;
    for (const g of galaxies) g.visible = true;

    // 隐藏穿梭期提示，显示抵达态 UI
    const hint = document.getElementById('warp-hint');
    const label = document.getElementById('warp-earth-label');
    const skip = document.getElementById('warp-skip');
    if (hint) hint.style.opacity = 0;
    if (label) label.style.opacity = 0;
    if (skip) skip.style.display = 'none';
    if (ui) {
      ui.classList.add('show');
      enterBtn = ui.querySelector('#warp-enter');
    }
    clock.getDelta();
    arriveLoop();
  }

  // ---- 抵达态交互绑定 ----
  function bindArriveControls(canvas) {
    canvas.addEventListener('pointerdown', e => {
      if (!arrived) return;
      dragging = true; moved = 0;
      lastX = e.clientX; lastY = e.clientY;
      velX = velY = 0;
      canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = 'grabbing';
    });
    canvas.addEventListener('pointermove', e => {
      if (!arrived || !dragging) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      moved += Math.abs(dx) + Math.abs(dy);
      earth.rotation.y += dx * 0.005;
      earth.rotation.x = clampTilt(earth.rotation.x + dy * 0.003);
      velX = dx * 0.005; velY = dy * 0.003;
    });
    const up = () => { dragging = false; canvas.style.cursor = 'grab'; };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('pointerleave', up);

    canvas.addEventListener('wheel', e => {
      if (!arrived) return;
      e.preventDefault();
      targetDist = Math.max(CAM_MIN, Math.min(CAM_MAX, targetDist * (1 + e.deltaY * 0.0012)));
      stepZoom(0.25); // 即时反馈（arriveLoop 会继续平滑逼近）
    }, { passive: false });

    // 双指捏合缩放（移动端）
    canvas.addEventListener('touchstart', e => {
      if (arrived && e.touches.length === 2) pinchDist = touchSpan(e);
    }, { passive: true });
    canvas.addEventListener('touchmove', e => {
      if (!arrived || e.touches.length !== 2) return;
      e.preventDefault();
      const d = touchSpan(e);
      if (pinchDist) {
        targetDist = Math.max(CAM_MIN, Math.min(CAM_MAX, targetDist * (pinchDist / d)));
        stepZoom(0.4);
      }
      pinchDist = d;
    }, { passive: false });
    canvas.addEventListener('touchend', () => { pinchDist = 0; }, { passive: true });

    // 双击进入地图（拖拽过的点击不算）
    canvas.addEventListener('dblclick', () => { if (arrived && moved < 8) goMap(); });
  }
  function touchSpan(e) {
    const [a, b] = [e.touches[0], e.touches[1]];
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  }

  function goMap() {
    if (onDone) { const f = onDone; onDone = null; f(); }
  }

  function finish() {
    if (arrived) return;
    if (!running) return;
    arrive();
  }

  window.WarpScene = {
    init(canvas) {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.setSize(innerWidth, innerHeight);
      renderer.outputEncoding = THREE.sRGBEncoding;
      scene = new THREE.Scene();
      scene.fog = new THREE.FogExp2(0x020208, 0.00022);
      camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 1, 8000);
      camera.position.set(0, 0, 0);
      buildStars(); buildGalaxies(); buildEarth();
      earth.visible = false;
      clock = new THREE.Clock();
      ui = document.getElementById('warp-ui');
      bindArriveControls(canvas);
      addEventListener('resize', () => {
        camera.aspect = innerWidth / innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(innerWidth, innerHeight);
      });
      (function loop() { requestAnimationFrame(loop); renderer.render(scene, camera); })();
    },
    start(cb) {
      onDone = cb;
      running = true;
      arrived = false;
      startTime = performance.now();
      clock.getDelta();
      document.getElementById('warp-hint').style.opacity = 1;
      document.getElementById('warp-earth-label').style.opacity = 0;
      frame();
    },
    skip() { arrive(); },
    get textureOk() { return earthTextureOk; },
    get arrived() { return arrived; },
    // 测试钩子：抵达态的旋转角与相机距离
    get __rotY() { return earth ? earth.rotation.y : 0; },
    get __dist() { return dist; },
    get __target() { return targetDist; },
    __snapZoom() { stepZoom(1); }   // 截图用：立即对齐到目标距离
  };

  // 「进入地图」按钮（静态绑定，页面加载即生效）
  document.addEventListener('click', e => {
    if (e.target && e.target.id === 'warp-enter') goMap();
  });
})();
