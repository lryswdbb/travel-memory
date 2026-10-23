// 全局变量
let scene, camera, renderer, controls;
let earth, clouds, atmosphere;
let visitedCities = {};
let currentCity = null;
let cityMarkers = [];
let countryBorders = [];
let cityBorders = [];
let raycaster, mouse;
let earthTexturesLoaded = false;

// 中国主要城市（带真实坐标）
const chinaCities = [
    { name: '北京', country: '中国', lat: 39.9042, lng: 116.4074, adcode: '110000' },
    { name: '上海', country: '中国', lat: 31.2304, lng: 121.4737, adcode: '310000' },
    { name: '广州', country: '中国', lat: 23.1291, lng: 113.2644, adcode: '440100' },
    { name: '深圳', country: '中国', lat: 22.5431, lng: 114.0579, adcode: '440300' },
    { name: '成都', country: '中国', lat: 30.5728, lng: 104.0668, adcode: '510100' },
    { name: '杭州', country: '中国', lat: 30.2741, lng: 120.1551, adcode: '330100' },
    { name: '武汉', country: '中国', lat: 30.5928, lng: 114.3055, adcode: '420100' },
    { name: '西安', country: '中国', lat: 34.3416, lng: 108.9398, adcode: '610100' },
    { name: '重庆', country: '中国', lat: 29.4316, lng: 106.9123, adcode: '500000' },
    { name: '南京', country: '中国', lat: 32.0603, lng: 118.7969, adcode: '320100' },
    { name: '天津', country: '中国', lat: 39.3434, lng: 117.3616, adcode: '120000' },
    { name: '苏州', country: '中国', lat: 31.2990, lng: 120.5853, adcode: '320500' },
    { name: '长沙', country: '中国', lat: 28.2280, lng: 112.9388, adcode: '430100' },
    { name: '郑州', country: '中国', lat: 34.7466, lng: 113.6254, adcode: '410100' },
    { name: '青岛', country: '中国', lat: 36.0671, lng: 120.3826, adcode: '370200' },
    { name: '大连', country: '中国', lat: 38.9140, lng: 121.6147, adcode: '210200' },
    { name: '厦门', country: '中国', lat: 24.4798, lng: 118.0894, adcode: '350200' },
    { name: '昆明', country: '中国', lat: 25.0389, lng: 102.7183, adcode: '530100' },
    { name: '哈尔滨', country: '中国', lat: 45.8038, lng: 126.5350, adcode: '230100' },
    { name: '沈阳', country: '中国', lat: 41.8057, lng: 123.4315, adcode: '210100' },
    { name: '合肥', country: '中国', lat: 31.8206, lng: 117.2272, adcode: '340100' },
    { name: '济南', country: '中国', lat: 36.6512, lng: 116.9972, adcode: '370100' },
    { name: '福州', country: '中国', lat: 26.0745, lng: 119.2965, adcode: '350100' },
    { name: '南昌', country: '中国', lat: 28.6820, lng: 115.8579, adcode: '360100' },
    { name: '贵阳', country: '中国', lat: 26.6470, lng: 106.6302, adcode: '520100' },
    { name: '南宁', country: '中国', lat: 22.8170, lng: 108.3665, adcode: '450100' },
    { name: '兰州', country: '中国', lat: 36.0611, lng: 103.8343, adcode: '620100' },
    { name: '太原', country: '中国', lat: 37.8706, lng: 112.5489, adcode: '140100' },
    { name: '长春', country: '中国', lat: 43.8171, lng: 125.3235, adcode: '220100' },
    { name: '乌鲁木齐', country: '中国', lat: 43.8256, lng: 87.6168, adcode: '650100' },
    { name: '拉萨', country: '中国', lat: 29.6500, lng: 91.1000, adcode: '540100' },
    { name: '呼和浩特', country: '中国', lat: 40.8424, lng: 111.7490, adcode: '150100' },
    { name: '石家庄', country: '中国', lat: 38.0428, lng: 114.5149, adcode: '130100' },
    { name: '海口', country: '中国', lat: 20.0174, lng: 110.3492, adcode: '460100' },
    { name: '银川', country: '中国', lat: 38.4872, lng: 106.2309, adcode: '640100' },
    { name: '西宁', country: '中国', lat: 36.6171, lng: 101.7782, adcode: '630100' }
];

// 世界城市
const worldCities = [
    { name: '东京', country: '日本', lat: 35.6762, lng: 139.6503 },
    { name: '大阪', country: '日本', lat: 34.6937, lng: 135.5023 },
    { name: '京都', country: '日本', lat: 35.0116, lng: 135.7681 },
    { name: '巴黎', country: '法国', lat: 48.8566, lng: 2.3522 },
    { name: '伦敦', country: '英国', lat: 51.5074, lng: -0.1278 },
    { name: '纽约', country: '美国', lat: 40.7128, lng: -74.0060 },
    { name: '洛杉矶', country: '美国', lat: 34.0522, lng: -118.2437 },
    { name: '旧金山', country: '美国', lat: 37.7749, lng: -122.4194 },
    { name: '悉尼', country: '澳大利亚', lat: -33.8688, lng: 151.2093 },
    { name: '罗马', country: '意大利', lat: 41.9028, lng: 12.4964 },
    { name: '巴塞罗那', country: '西班牙', lat: 41.3851, lng: 2.1734 },
    { name: '马德里', country: '西班牙', lat: 40.4168, lng: -3.7038 },
    { name: '曼谷', country: '泰国', lat: 13.7563, lng: 100.5018 },
    { name: '新加坡', country: '新加坡', lat: 1.3521, lng: 103.8194 },
    { name: '迪拜', country: '阿联酋', lat: 25.2048, lng: 55.2708 },
    { name: '开罗', country: '埃及', lat: 30.0444, lng: 31.2357 },
    { name: '莫斯科', country: '俄罗斯', lat: 55.7558, lng: 37.6173 },
    { name: '温哥华', country: '加拿大', lat: 49.2827, lng: -123.1207 },
    { name: '多伦多', country: '加拿大', lat: 43.6532, lng: -79.3832 },
    { name: '首尔', country: '韩国', lat: 37.5665, lng: 126.9780 },
    { name: '香港', country: '中国', lat: 22.3193, lng: 114.1694 },
    { name: '台北', country: '中国', lat: 25.0330, lng: 121.5654 },
    { name: '柏林', country: '德国', lat: 52.5200, lng: 13.4050 },
    { name: '阿姆斯特丹', country: '荷兰', lat: 52.3676, lng: 4.9041 },
    { name: '伊斯坦布尔', country: '土耳其', lat: 41.0082, lng: 28.9784 },
    { name: '墨西哥城', country: '墨西哥', lat: 19.4326, lng: -99.1332 },
    { name: '里约热内卢', country: '巴西', lat: -22.9068, lng: -43.1729 },
    { name: '开普敦', country: '南非', lat: -33.9249, lng: 18.4241 },
    { name: '新德里', country: '印度', lat: 28.6139, lng: 77.2090 },
    { name: '吉隆坡', country: '马来西亚', lat: 3.1390, lng: 101.6869 }
];

// 页面切换
const welcomePage = document.getElementById('welcome-page');
const globePage = document.getElementById('globe-page');
const loading = document.getElementById('loading');

// 进入按钮点击事件
document.getElementById('enter-btn').addEventListener('click', () => {
    welcomePage.style.animation = 'fadeOut 0.5s ease-out forwards';
    setTimeout(() => {
        welcomePage.classList.remove('active');
        globePage.classList.add('active');
        initGlobe();
    }, 500);
});

// 初始化3D地球
async function initGlobe() {
    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.01, 1000);
    camera.position.z = 3;

    const canvas = document.getElementById('main-canvas');
    renderer = new THREE.WebGLRenderer({
        canvas: canvas,
        antialias: true,
        alpha: true
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.4;
    controls.minDistance = 1.3;
    controls.maxDistance = 8;
    controls.enablePan = false;

    // 光源
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xffffff, 1.2);
    sunLight.position.set(5, 3, 5);
    scene.add(sunLight);

    const fillLight = new THREE.DirectionalLight(0x4a90e2, 0.3);
    fillLight.position.set(-5, -3, -5);
    scene.add(fillLight);

    // 星空背景
    createStarField();

    // 创建真实纹理地球
    await createRealisticEarth();

    // 加载真实国界线
    await loadCountryBorders();

    // 加载中国城市边界
    await loadChinaCityBorders();

    // 初始化射线检测
    raycaster = new THREE.Raycaster();
    raycaster.params.Points = { threshold: 0.05 };
    mouse = new THREE.Vector2();

    // 加载已保存的数据
    loadVisitedCities();

    // 添加城市标记
    addAllCityMarkers();

    // 隐藏加载提示
    loading.style.display = 'none';

    // 地球从小变大
    animateEarthGrowth();

    // 开始动画
    animate();

    // 事件
    canvas.addEventListener('click', onCanvasClick);
    canvas.addEventListener('mousemove', onCanvasMouseMove);
    window.addEventListener('resize', onWindowResize);
}

// 创建星空背景
function createStarField() {
    const starsGeometry = new THREE.BufferGeometry();
    const starsMaterial = new THREE.PointsMaterial({
        color: 0xffffff,
        size: 0.015,
        transparent: true,
        sizeAttenuation: true
    });

    const starsVertices = [];
    for (let i = 0; i < 15000; i++) {
        const r = 50 + Math.random() * 150;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        starsVertices.push(
            r * Math.sin(phi) * Math.cos(theta),
            r * Math.sin(phi) * Math.sin(theta),
            r * Math.cos(phi)
        );
    }

    starsGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starsVertices, 3));
    const starField = new THREE.Points(starsGeometry, starsMaterial);
    scene.add(starField);
}

// 创建真实纹理地球
async function createRealisticEarth() {
    const textureLoader = new THREE.TextureLoader();
    const loadingManager = new THREE.LoadingManager();

    // 地球几何体（高精度）
    const geometry = new THREE.SphereGeometry(1, 128, 128);

    // 使用真实地球纹理
    const earthTexture = textureLoader.load(
        'https://unpkg.com/three-globe@2.24.3/example/img/earth-blue-marble.jpg',
        undefined,
        undefined,
        () => {
            // 如果加载失败，使用备用纹理
            console.log('使用备用地球纹理');
            earth.material.map = createFallbackTexture();
            earth.material.needsUpdate = true;
        }
    );

    const bumpTexture = textureLoader.load(
        'https://unpkg.com/three-globe@2.24.3/example/img/earth-topology.png'
    );

    const material = new THREE.MeshPhongMaterial({
        map: earthTexture,
        bumpMap: bumpTexture,
        bumpScale: 0.03,
        specular: new THREE.Color(0x222222),
        shininess: 10
    });

    earth = new THREE.Mesh(geometry, material);
    earth.scale.set(0.01, 0.01, 0.01);
    scene.add(earth);

    // 云层
    const cloudsGeometry = new THREE.SphereGeometry(1.008, 128, 128);
    const cloudsTexture = textureLoader.load(
        'https://unpkg.com/three-globe@2.24.3/example/img/earth-water.png'
    );
    const cloudsMaterial = new THREE.MeshPhongMaterial({
        map: cloudsTexture,
        transparent: true,
        opacity: 0.35,
        depthWrite: false
    });
    clouds = new THREE.Mesh(cloudsGeometry, cloudsMaterial);
    clouds.scale.set(0.01, 0.01, 0.01);
    scene.add(clouds);

    // 大气层
    const atmosphereGeometry = new THREE.SphereGeometry(1.05, 64, 64);
    const atmosphereMaterial = new THREE.ShaderMaterial({
        vertexShader: `
            varying vec3 vNormal;
            void main() {
                vNormal = normalize(normalMatrix * normal);
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            varying vec3 vNormal;
            void main() {
                float intensity = pow(0.65 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.0);
                gl_FragColor = vec4(0.3, 0.6, 1.0, 1.0) * intensity;
            }
        `,
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide,
        transparent: true
    });
    atmosphere = new THREE.Mesh(atmosphereGeometry, atmosphereMaterial);
    atmosphere.scale.set(0.01, 0.01, 0.01);
    scene.add(atmosphere);
}

// 备用纹理
function createFallbackTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 2048;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d');

    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, '#1a5276');
    gradient.addColorStop(0.5, '#2980b9');
    gradient.addColorStop(1, '#1a5276');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    return new THREE.CanvasTexture(canvas);
}

// 加载真实国界线
async function loadCountryBorders() {
    try {
        const response = await fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json');
        const worldData = await response.json();

        // 将 TopoJSON 转换为 GeoJSON
        const countries = topojson.feature(worldData, worldData.objects.countries);

        // 绘制国界线
        countries.features.forEach(feature => {
            drawGeoJSONBorder(feature, 0x88aacc, 0.5, 0.003);
        });

        // 绘制国家填充（半透明）
        countries.features.forEach(feature => {
            drawGeoJSONFill(feature, 0x4a90e2, 0.05);
        });

    } catch (error) {
        console.error('加载国界线失败:', error);
    }
}

// 绘制 GeoJSON 边界线
function drawGeoJSONBorder(feature, color, opacity, lineWidth) {
    const coordinates = extractCoordinates(feature);

    coordinates.forEach(ring => {
        const points = [];
        ring.forEach(coord => {
            const pos = latLngToVector3(coord[1], coord[0], 1.002);
            points.push(pos);
        });

        if (points.length < 2) return;

        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const material = new THREE.LineBasicMaterial({
            color: color,
            transparent: true,
            opacity: opacity,
            linewidth: lineWidth
        });

        const line = new THREE.Line(geometry, material);
        earth.add(line);
        countryBorders.push(line);
    });
}

// 绘制 GeoJSON 填充
function drawGeoJSONFill(feature, color, opacity) {
    // 简化处理 - 只绘制边界，不填充
    // 真实填充需要复杂的三角化，这里用边界线表示
}

// 提取坐标
function extractCoordinates(feature) {
    const coordinates = [];

    if (feature.geometry.type === 'Polygon') {
        feature.geometry.coordinates.forEach(ring => {
            coordinates.push(ring);
        });
    } else if (feature.geometry.type === 'MultiPolygon') {
        feature.geometry.coordinates.forEach(polygon => {
            polygon.forEach(ring => {
                coordinates.push(ring);
            });
        });
    }

    return coordinates;
}

// 加载中国城市边界
async function loadChinaCityBorders() {
    try {
        // 加载中国省份边界
        const provinceResponse = await fetch('https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json');
        const provinceData = await provinceResponse.json();

        provinceData.features.forEach(feature => {
            const provinceName = feature.properties.name;
            const provinceKey = `${provinceName}-中国`;
            const isVisited = visitedCities[provinceKey];

            drawCityBorder(feature, provinceName, provinceKey, isVisited, 'province');
        });

        // 加载主要城市边界
        const majorCityCodes = [
            '110000', '310000', '440100', '440300', '510100',
            '330100', '420100', '610100', '500000', '320100',
            '120000', '320500', '430100', '410100', '370200',
            '210200', '350200', '530100', '230100', '210100'
        ];

        for (const adcode of majorCityCodes) {
            try {
                const cityResponse = await fetch(`https://geo.datav.aliyun.com/areas_v3/bound/${adcode}_full.json`);
                const cityData = await cityResponse.json();

                const cityName = cityData.features[0]?.properties.name || adcode;
                const cityKey = `${cityName}-中国`;
                const isVisited = visitedCities[cityKey];

                cityData.features.forEach(feature => {
                    drawCityBorder(feature, cityName, cityKey, isVisited, 'city');
                });
            } catch (e) {
                // 忽略单个城市加载失败
            }
        }
    } catch (error) {
        console.error('加载中国城市边界失败:', error);
    }
}

// 绘制城市边界
function drawCityBorder(feature, name, key, isVisited, type) {
    const coordinates = extractCoordinates(feature);

    coordinates.forEach(ring => {
        const points = [];
        ring.forEach(coord => {
            const pos = latLngToVector3(coord[1], coord[0], 1.003);
            points.push(pos);
        });

        if (points.length < 2) return;

        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const material = new THREE.LineBasicMaterial({
            color: isVisited ? 0xf093fb : 0xff6b6b,
            transparent: true,
            opacity: isVisited ? 0.9 : 0.4,
            linewidth: 1
        });

        const line = new THREE.Line(geometry, material);
        line.userData = { name, key, type };
        earth.add(line);
        cityBorders.push(line);
    });

    // 如果已访问，添加区域填充效果
    if (isVisited) {
        drawCityHighlight(feature, name, key);
    }
}

// 绘制城市高亮区域
function drawCityHighlight(feature, name, key) {
    const coordinates = extractCoordinates(feature);

    coordinates.forEach(ring => {
        // 简化：将多边形转换为点集，创建三角面
        const shape = new THREE.Shape();
        const projectedPoints = [];

        ring.forEach(coord => {
            const x = coord[0];
            const y = coord[1];
            projectedPoints.push(new THREE.Vector2(x, y));
        });

        if (projectedPoints.length < 3) return;

        // 使用简单的三角化
        try {
            shape.setFromPoints(projectedPoints);
            const shapeGeometry = new THREE.ShapeGeometry(shape, 8);

            // 将2D形状映射到球面
            const positions = shapeGeometry.attributes.position;
            const newPositions = new Float32Array(positions.count * 3);

            for (let i = 0; i < positions.count; i++) {
                const lng = positions.getX(i);
                const lat = positions.getY(i);
                const pos = latLngToVector3(lat, lng, 1.004);
                newPositions[i * 3] = pos.x;
                newPositions[i * 3 + 1] = pos.y;
                newPositions[i * 3 + 2] = pos.z;
            }

            shapeGeometry.setAttribute('position', new THREE.BufferAttribute(newPositions, 3));
            shapeGeometry.computeVertexNormals();

            const material = new THREE.MeshBasicMaterial({
                color: 0xf093fb,
                transparent: true,
                opacity: 0.3,
                side: THREE.DoubleSide,
                depthWrite: false
            });

            const mesh = new THREE.Mesh(shapeGeometry, material);
            mesh.userData = { name, key, type: 'highlight' };
            earth.add(mesh);
            cityBorders.push(mesh);
        } catch (e) {
            // 忽略三角化失败
        }
    });
}

// 地球从小变大动画
function animateEarthGrowth() {
    const duration = 2000;
    const startTime = Date.now();

    function update() {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);

        // 弹性缓动
        const easeProgress = 1 - Math.pow(1 - progress, 4);

        const scale = 0.01 + easeProgress * 0.99;
        earth.scale.set(scale, scale, scale);
        clouds.scale.set(scale, scale, scale);
        atmosphere.scale.set(scale * 1.05, scale * 1.05, scale * 1.05);

        if (progress < 1) {
            requestAnimationFrame(update);
        }
    }

    update();
}

// 添加所有城市标记
function addAllCityMarkers() {
    // 中国城市
    chinaCities.forEach(city => {
        addCityMarker(city, `${city.name}-${city.country}`);
    });

    // 世界城市
    worldCities.forEach(city => {
        addCityMarker(city, `${city.name}-${city.country}`);
    });
}

// 添加城市标记
function addCityMarker(city, cityKey) {
    const isVisited = visitedCities[cityKey];

    const position = latLngToVector3(city.lat, city.lng, 1.01);

    // 标记点
    const markerGeometry = new THREE.SphereGeometry(0.012, 16, 16);
    const markerMaterial = new THREE.MeshBasicMaterial({
        color: isVisited ? 0xf093fb : 0xffaa00,
        transparent: true,
        opacity: 0.9
    });

    const marker = new THREE.Mesh(markerGeometry, markerMaterial);
    marker.position.copy(position);
    marker.userData = { city, cityKey };

    earth.add(marker);
    cityMarkers.push(marker);

    // 外圈
    const ringGeometry = new THREE.RingGeometry(0.015, 0.02, 32);
    const ringMaterial = new THREE.MeshBasicMaterial({
        color: isVisited ? 0xf093fb : 0xffaa00,
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide
    });
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.position.copy(position);
    ring.lookAt(new THREE.Vector3(0, 0, 0));
    marker.add(ring);
    ring.position.set(0, 0, 0);

    // 已访问的光晕
    if (isVisited) {
        const glowGeometry = new THREE.SphereGeometry(0.025, 16, 16);
        const glowMaterial = new THREE.MeshBasicMaterial({
            color: 0xf093fb,
            transparent: true,
            opacity: 0.2
        });
        const glow = new THREE.Mesh(glowGeometry, glowMaterial);
        marker.add(glow);
        marker.userData.glow = glow;
    }

    // 城市名称标签
    const labelDiv = document.createElement('div');
    labelDiv.className = 'city-label';
    labelDiv.textContent = city.name;
    labelDiv.style.cssText = `
        position: absolute;
        color: ${isVisited ? '#f093fb' : '#fff'};
        font-size: 10px;
        pointer-events: none;
        text-shadow: 0 0 3px rgba(0,0,0,0.8);
        white-space: nowrap;
        opacity: 0;
        transition: opacity 0.3s;
    `;
    document.body.appendChild(labelDiv);
    marker.userData.label = labelDiv;
}

// 经纬度转3D坐标
function latLngToVector3(lat, lng, radius) {
    const phi = (90 - lat) * (Math.PI / 180);
    const theta = (lng + 180) * (Math.PI / 180);

    const x = -radius * Math.sin(phi) * Math.cos(theta);
    const y = radius * Math.cos(phi);
    const z = radius * Math.sin(phi) * Math.sin(theta);

    return new THREE.Vector3(x, y, z);
}

// 画布点击事件
function onCanvasClick(event) {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    const intersects = raycaster.intersectObjects(cityMarkers);

    if (intersects.length > 0) {
        const marker = intersects[0].object;
        const city = marker.userData.city;
        const cityKey = marker.userData.cityKey;
        openCityModal(city, cityKey);
    }
}

// 画布鼠标移动
function onCanvasMouseMove(event) {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    const intersects = raycaster.intersectObjects(cityMarkers);

    // 重置所有标记
    cityMarkers.forEach(marker => {
        if (marker.userData.label) {
            marker.userData.label.style.opacity = '0';
        }
    });

    document.getElementById('main-canvas').style.cursor = 'grab';

    if (intersects.length > 0) {
        const marker = intersects[0].object;
        if (marker.userData.label) {
            marker.userData.label.style.opacity = '1';
        }
        document.getElementById('main-canvas').style.cursor = 'pointer';
    }
}

// 更新标签位置
function updateLabels() {
    cityMarkers.forEach(marker => {
        if (!marker.userData.label) return;

        const worldPos = new THREE.Vector3();
        marker.getWorldPosition(worldPos);

        // 检查是否在相机前方
        const cameraDir = new THREE.Vector3();
        camera.getWorldDirection(cameraDir);
        const markerDir = worldPos.clone().normalize();

        if (cameraDir.dot(markerDir) < 0.3) {
            marker.userData.label.style.display = 'none';
            return;
        }

        marker.userData.label.style.display = 'block';

        const screenPos = worldPos.clone().project(camera);
        const x = (screenPos.x * 0.5 + 0.5) * window.innerWidth;
        const y = (-screenPos.y * 0.5 + 0.5) * window.innerHeight;

        marker.userData.label.style.left = `${x + 15}px`;
        marker.userData.label.style.top = `${y - 10}px`;
    });
}

// 打开城市弹窗
function openCityModal(city, cityKey) {
    currentCity = { ...city, key: cityKey };

    const modal = document.getElementById('city-modal');
    const cityName = document.getElementById('modal-city-name');
    const photoGrid = document.getElementById('photo-grid');
    const uploadPlaceholder = document.getElementById('upload-placeholder');

    cityName.textContent = `${city.name}, ${city.country}`;

    photoGrid.innerHTML = '';
    const photos = visitedCities[cityKey]?.photos || [];

    if (photos.length > 0) {
        uploadPlaceholder.style.display = 'none';
        photos.forEach((photo, index) => {
            addPhotoToGrid(photo, index);
        });
    } else {
        uploadPlaceholder.style.display = 'block';
    }

    modal.classList.add('active');
}

// 关闭弹窗
document.querySelector('.close-btn').addEventListener('click', () => {
    document.getElementById('city-modal').classList.remove('active');
    currentCity = null;
});

document.getElementById('city-modal').addEventListener('click', (e) => {
    if (e.target.id === 'city-modal') {
        document.getElementById('city-modal').classList.remove('active');
        currentCity = null;
    }
});

document.getElementById('photo-upload-area').addEventListener('click', (e) => {
    if (e.target.closest('.photo-item')) return;
    document.getElementById('photo-input').click();
});

document.getElementById('photo-input').addEventListener('change', (e) => {
    const files = Array.from(e.target.files);

    files.forEach(file => {
        const reader = new FileReader();
        reader.onload = (event) => {
            savePhoto(event.target.result);
        };
        reader.readAsDataURL(file);
    });

    e.target.value = '';
});

function savePhoto(photoData) {
    if (!currentCity) return;

    const cityKey = currentCity.key;

    if (!visitedCities[cityKey]) {
        visitedCities[cityKey] = {
            name: currentCity.name,
            country: currentCity.country,
            photos: []
        };
    }

    visitedCities[cityKey].photos.push(photoData);
    localStorage.setItem('visitedCities', JSON.stringify(visitedCities));

    const photoGrid = document.getElementById('photo-grid');
    const uploadPlaceholder = document.getElementById('upload-placeholder');
    uploadPlaceholder.style.display = 'none';

    addPhotoToGrid(photoData, visitedCities[cityKey].photos.length - 1);
    updateCityMarker(cityKey);
    updateCityCount();
}

function updateCityMarker(cityKey) {
    const marker = cityMarkers.find(m => m.userData.cityKey === cityKey);
    if (!marker) return;

    marker.material.color.setHex(0xf093fb);

    if (!marker.userData.glow) {
        const glowGeometry = new THREE.SphereGeometry(0.025, 16, 16);
        const glowMaterial = new THREE.MeshBasicMaterial({
            color: 0xf093fb,
            transparent: true,
            opacity: 0.2
        });
        const glow = new THREE.Mesh(glowGeometry, glowMaterial);
        marker.add(glow);
        marker.userData.glow = glow;
    }

    if (marker.userData.label) {
        marker.userData.label.style.color = '#f093fb';
    }
}

function addPhotoToGrid(photoData, index) {
    const photoGrid = document.getElementById('photo-grid');

    const photoItem = document.createElement('div');
    photoItem.className = 'photo-item';

    const rotation = (Math.random() - 0.5) * 10;
    photoItem.style.setProperty('--rotation', `${rotation}deg`);

    const img = document.createElement('img');
    img.src = photoData;
    img.alt = `照片 ${index + 1}`;

    photoItem.appendChild(img);

    photoItem.addEventListener('click', () => {
        openPhotoViewer(photoData);
    });

    photoGrid.appendChild(photoItem);
}

function openPhotoViewer(photoData) {
    const viewer = document.getElementById('photo-viewer');
    const viewerImg = document.getElementById('viewer-image');
    viewerImg.src = photoData;
    viewer.classList.add('active');
}

document.querySelector('.close-viewer').addEventListener('click', () => {
    document.getElementById('photo-viewer').classList.remove('active');
});

document.getElementById('photo-viewer').addEventListener('click', (e) => {
    if (e.target.id === 'photo-viewer') {
        document.getElementById('photo-viewer').classList.remove('active');
    }
});

function updateCityCount() {
    const count = Object.keys(visitedCities).length;
    document.getElementById('city-count').textContent = count;
}

function loadVisitedCities() {
    const saved = localStorage.getItem('visitedCities');
    if (saved) {
        visitedCities = JSON.parse(saved);
    }
}

function animate() {
    requestAnimationFrame(animate);

    controls.update();

    // 地球缓慢自转
    if (earth && !controls.enabled) {
        earth.rotation.y += 0.0005;
    }
    if (clouds) {
        clouds.rotation.y += 0.0003;
    }

    // 光晕脉冲
    cityMarkers.forEach(marker => {
        if (marker.userData.glow) {
            const scale = 1 + Math.sin(Date.now() * 0.003) * 0.3;
            marker.userData.glow.scale.set(scale, scale, scale);
        }
    });

    // 更新标签
    updateLabels();

    renderer.render(scene, camera);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// 添加样式
const style = document.createElement('style');
style.textContent = `
    @keyframes fadeOut {
        from { opacity: 1; }
        to { opacity: 0; }
    }

    .loading {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        text-align: center;
        color: #fff;
        z-index: 100;
    }

    .loading-spinner {
        width: 50px;
        height: 50px;
        border: 4px solid rgba(255, 255, 255, 0.3);
        border-top-color: #fff;
        border-radius: 50%;
        animation: spin 1s linear infinite;
        margin: 0 auto 1rem;
    }

    @keyframes spin {
        to { transform: rotate(360deg); }
    }

    .city-label {
        font-weight: 500;
        letter-spacing: 0.5px;
    }
`;
document.head.appendChild(style);
