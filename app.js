// app.js - Optimized Three.js + MediaPipe hands particles
// Put this file alongside your index.html & style.css

// ---- Globals ----
let scene, camera, renderer, clock;
let particleSystem = null, starField = null;
let hands = null, videoElement = null;
const state = {
  handPosition: new THREE.Vector3(0, 0, 0),
  currentGesture: 'none',
  customText: 'I LOVE U',
  isForcedShape: false,
  forcedShapeTimer: null,
  time: 0,
  particleCount: window.innerWidth < 768 ? 2500 : 4000,
  lastParticleCount: 0
};

// Gesture map (strings used by detection)
const GESTURES = { NONE: 'none', FIST: 'fist', OPEN: 'open', PEACE: 'peace', METAL: 'metal' };

// ---- Init ----
document.addEventListener('DOMContentLoaded', () => {
  initThree();
  initMediaPipe();
});

// ---- Three.js init ----
function initThree() {
  clock = new THREE.Clock();
  const container = document.getElementById('canvas-container');
  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x000000, 0.0005);

  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 3000);
  camera.position.z = 600;

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  container.appendChild(renderer.domElement);

  // lighting (subtle)
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dir = new THREE.DirectionalLight(0xffffff, 0.3);
  dir.position.set(5, 10, 7);
  scene.add(dir);

  createStarField();
  createParticleSystem();

  window.addEventListener('resize', onWindowResize, { passive: true });
  animate();
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);

  // decide particle count scale on resize but avoid recreating too often
  state.particleCount = window.innerWidth < 768 ? 2500 : 4000;
  if (Math.abs(state.particleCount - state.lastParticleCount) > 500) {
    // recreate only when there's a big difference
    createParticleSystem();
  }
}

// ---- Starfield (keeps low cost, separate shader) ----
function createStarField() {
  if (starField) {
    scene.remove(starField);
    try { starField.geometry.dispose(); starField.material.dispose(); } catch(e) {}
  }

  const count = 2500;
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const opacities = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const r = 900 + Math.random() * 900;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);
    sizes[i] = 1.0 + Math.random() * 2.0;
    opacities[i] = 0.2 + Math.random() * 0.8;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  geo.setAttribute('opacity', new THREE.BufferAttribute(opacities, 1));

  const mat = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, color: { value: new THREE.Color(0xffffff) } },
    vertexShader: `
      attribute float size;
      attribute float opacity;
      varying float vOpacity;
      uniform float time;
      void main() {
        vOpacity = opacity * (0.6 + 0.4 * sin(time * 0.7 + position.x * 0.003));
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * (300.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      varying float vOpacity;
      uniform vec3 color;
      void main() {
        float d = length(gl_PointCoord - vec2(0.5));
        if (d > 0.5) discard;
        float g = pow(1.0 - d * 2.0, 1.6);
        gl_FragColor = vec4(color, g * vOpacity);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });

  starField = new THREE.Points(geo, mat);
  scene.add(starField);
}

// ---- Particle System (GPU-driven) ----
function createParticleSystem() {
  // if same count and exists, just update attributes if needed
  if (particleSystem && state.particleCount === state.lastParticleCount) {
    return;
  }

  // remove old
  if (particleSystem) {
    scene.remove(particleSystem);
    try { particleSystem.geometry.dispose(); particleSystem.material.dispose(); } catch(e) {}
    particleSystem = null;
  }

  const count = state.particleCount;
  state.lastParticleCount = count;

  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const randoms = new Float32Array(count * 4);

  const baseColor = new THREE.Color();

  for (let i = 0; i < count; i++) {
    // spread initial positions over a large cube so shader can morph freely
    positions[i * 3] = (Math.random() - 0.5) * 1200;
    positions[i * 3 + 1] = (Math.random() - 0.5) * 1200;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 1200;

    // store hue-ish base color (cyan-blue)
    baseColor.setHSL(0.55 + (Math.random() - 0.5) * 0.08, 1.0, 0.5);
    colors[i * 3] = baseColor.r;
    colors[i * 3 + 1] = baseColor.g;
    colors[i * 3 + 2] = baseColor.b;

    sizes[i] = 1.0 + Math.random() * 3.0;

    randoms[i * 4] = Math.random();      // x: offset
    randoms[i * 4 + 1] = Math.random();  // y: speed
    randoms[i * 4 + 2] = Math.random();  // z: phase
    randoms[i * 4 + 3] = Math.random();  // w: selector (ring/planet/etc)
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  geo.setAttribute('random', new THREE.BufferAttribute(randoms, 4));

  // Shader material
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      handPos: { value: new THREE.Vector3(0, 0, 0) }, // normalized -1..1
      gesture: { value: 0.0 }, // float indicator
      uColor: { value: new THREE.Color(0x88ddff) }, // target tint
      colorMix: { value: 0.45 } // how much to mix attribute color toward uColor
    },
    vertexShader: `
      attribute float size;
      attribute vec3 color;
      attribute vec4 random;
      uniform float time;
      uniform vec3 handPos;
      uniform float gesture;
      uniform vec3 uColor;
      uniform float colorMix;
      varying vec3 vColor;
      varying float vAlpha;

      // simple hash/noise
      float hash13(vec3 p) {
        return fract(sin(dot(p, vec3(12.9898,78.233,45.164))) * 43758.5453);
      }

      void main() {
        vColor = mix(color, uColor, colorMix);

        float t = time * 2.0;
        float r = random.x;
        float sp = 0.5 + random.y * 0.8;
        float ph = random.z * 6.28318;
        vec3 pos = position;

        // convert handPos normalized to world-like coords for shaping
        vec3 hand = handPos * 500.0;

        vec3 target = pos;

        // gesture cases using float comparisons (more robust than int)
        if (gesture > 0.5 && gesture < 1.5) {
          // FIST -> saturn ring + planet
          float selector = step(0.3, random.w);
          if (selector > 0.5) {
            float angle = r * 6.28318 + t * 0.35;
            float ringR = 120.0 + r * 80.0;
            target.x = hand.x + cos(angle) * ringR;
            target.y = hand.y + sin(angle) * ringR * 0.22;
            target.z = hand.z + sin(angle * 0.5) * 60.0;
          } else {
            float pr = r * 60.0;
            float theta = random.w * 3.14159;
            float phi = r * 6.28318;
            target.x = hand.x + pr * sin(theta) * cos(phi + t * 0.6);
            target.y = hand.y + pr * sin(theta) * sin(phi + t * 0.6);
            target.z = hand.z + pr * cos(theta);
          }
        } else if (gesture > 1.5 && gesture < 2.5) {
          // OPEN palm -> central moon + wanderers
          float isCenter = step(0.28, random.w);
          if (isCenter > 0.5) {
            float theta = r * 3.14159;
            float phi = random.w * 6.28318;
            float sr = 40.0 + r * 80.0;
            target.x = hand.x + sr * sin(theta) * cos(phi + t * 0.2);
            target.y = hand.y + sr * sin(theta) * sin(phi + t * 0.2);
            target.z = hand.z + sr * cos(theta);
          } else {
            float wanderR = 160.0 + r * 200.0;
            float a = t * 0.18 + ph;
            target.x = hand.x + cos(a) * wanderR;
            target.y = hand.y + sin(a * 1.2) * (wanderR * 0.25);
            target.z = hand.z + sin(t + r * 10.0) * 100.0;
          }
        } else if (gesture > 2.5 && gesture < 3.5) {
          // PEACE -> text-like formation (looser math)
          float charIndex = floor(r * 6.0);
          float charX = (charIndex - 2.5) * 48.0;
          float yOffset = sin(r * 20.0 + t) * 6.0;
          target.x = hand.x + charX + (random.w - 0.5) * 36.0;
          target.y = hand.y + yOffset + (r - 0.5) * 68.0;
          target.z = hand.z + sin(t * 2.0 + r * 10.0) * 30.0;
        } else if (gesture > 3.5 && gesture < 4.5) {
          // METAL -> beating heart parametric
          float heartT = r * 6.28318;
          float beat = 1.0 + sin(t * 8.0) * 0.12;
          float hx = 16.0 * pow(sin(heartT), 3.0);
          float hy = 13.0 * cos(heartT) - 5.0 * cos(2.0 * heartT) - 2.0 * cos(3.0 * heartT) - cos(4.0 * heartT);
          float scale = 5.2 * beat;
          target.x = hand.x + hx * scale;
          target.y = hand.y - hy * scale + 18.0;
          target.z = hand.z + sin(heartT * 3.0 + t) * 30.0;
        } else {
          // NONE -> slow float
          target.x = pos.x + sin(t * sp + ph) * 48.0;
          target.y = pos.y + cos(t * sp * 0.7 + ph) * 48.0;
          target.z = pos.z + sin(t * 0.3 + r * 8.0) * 24.0;
        }

        // interpolate smoothly toward target
        pos = mix(pos, target, 0.12);

        // add small micro-motion
        pos += vec3(
          sin(t + r * 10.0) * 1.6,
          cos(t + r * 10.0) * 1.6,
          sin(t * 0.5 + r * 10.0) * 1.6
        );

        vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
        gl_PointSize = size * (360.0 / -mvPos.z);
        gl_Position = projectionMatrix * mvPos;

        vAlpha = 1.0;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - vec2(0.5));
        if (d > 0.5) discard;
        float glow = pow(1.0 - d * 2.0, 1.5);
        gl_FragColor = vec4(vColor, glow * vAlpha);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });

  particleSystem = new THREE.Points(geo, mat);
  scene.add(particleSystem);
}

// ---- Animation ----
let colorUpdateTick = 0;
function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  state.time += dt;

  // starfield
  if (starField) starField.material.uniforms.time.value = state.time;

  // particles
  if (particleSystem) {
    const mat = particleSystem.material;
    mat.uniforms.time.value = state.time;
    mat.uniforms.handPos.value.copy(state.handPosition);
    // gesture mapping float
    const gm = { 'none': 0, 'fist': 1, 'open': 2, 'peace': 3, 'metal': 4 };
    mat.uniforms.gesture.value = gm[state.currentGesture] || 0;

    // set target tint by gesture (simple and cheap)
    let tintHex = 0x88ddff; // default cyan
    switch (state.currentGesture) {
      case GESTURES.FIST: tintHex = 0xffb66b; break;   // warm gold
      case GESTURES.OPEN: tintHex = 0x6fe8d1; break;   // mint
      case GESTURES.PEACE: tintHex = 0xa58bff; break;  // purple
      case GESTURES.METAL: tintHex = 0xff6fa2; break;  // pink
      default: tintHex = 0x88ddff;
    }
    particleSystem.material.uniforms.uColor.value.setHex(tintHex);

    // subtle camera follow
    camera.position.x += (state.handPosition.x * 150 - camera.position.x) * 0.06;
    camera.position.y += (state.handPosition.y * 150 - camera.position.y) * 0.06;
    camera.position.z += ((600 + state.handPosition.z * 220) - camera.position.z) * 0.03;
  }

  // rotate scene slowly
  if (scene) scene.rotation.y += 0.0006;

  renderer.render(scene, camera);
}

// ---- MediaPipe Hands setup ----
function initMediaPipe() {
  videoElement = document.getElementById('inputVideo');
  if (!videoElement) {
    console.warn('inputVideo element not found');
    return;
  }

  hands = new Hands({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}` });
  hands.setOptions({ maxNumHands: 1, modelComplexity: 1, minDetectionConfidence: 0.55, minTrackingConfidence: 0.55 });
  hands.onResults(onHandResults);

  const cam = new Camera(videoElement, {
    onFrame: async () => { await hands.send({ image: videoElement }); },
    width: 640, height: 480
  });

  cam.start().then(() => {
    const ld = document.getElementById('loading');
    if (ld) ld.classList.add('hidden');
  }).catch(err => {
    console.error('camera start failed', err);
    const ld = document.getElementById('loading');
    if (ld) ld.innerHTML = '<p>Error mengakses kamera. Cek izin.</p>';
  });
}

function onHandResults(results) {
  const statusEl = document.getElementById('status');
  if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
    const lm = results.multiHandLandmarks[0];
    const wrist = lm[0];
    const midBase = lm[9];

    // convert to -1..1 coords (mirror on X for intuitive mapping)
    state.handPosition.x = (1 - (wrist.x + midBase.x) / 2) * 2 - 1;
    state.handPosition.y = -((wrist.y + midBase.y) / 2 * 2 - 1);

    // depth using landmarks (z is negative when closer)
    let zavg = (wrist.z + midBase.z) / 2;
    zavg = -zavg;
    zavg = Math.max(-1, Math.min(1, zavg));
    state.handPosition.z = zavg;

    if (!state.isForcedShape) state.currentGesture = detectGesture(lm);

    if (statusEl) {
      statusEl.textContent = `Terdeteksi: ${displayGestureName(state.currentGesture)}`;
      statusEl.classList.add('detected');
    }
  } else {
    if (!state.isForcedShape) state.currentGesture = GESTURES.NONE;
    if (statusEl) {
      statusEl.textContent = 'Menunggu tangan...';
      statusEl.classList.remove('detected');
    }
  }
}

// ---- Gesture detection helpers ----
function detectGesture(landmarks) {
  const fingers = {
    thumb: isThumbExtended(landmarks),
    index: isFingerExtended(landmarks, 8, 5),
    middle: isFingerExtended(landmarks, 12, 9),
    ring: isFingerExtended(landmarks, 16, 13),
    pinky: isFingerExtended(landmarks, 20, 17)
  };

  if (fingers.index && !fingers.middle && !fingers.ring && fingers.pinky) return GESTURES.METAL;
  if (fingers.index && fingers.middle && !fingers.ring && !fingers.pinky) return GESTURES.PEACE;
  if (!fingers.index && !fingers.middle && !fingers.ring && !fingers.pinky) return GESTURES.FIST;
  if (fingers.index && fingers.middle && fingers.ring && fingers.pinky) return GESTURES.OPEN;
  return state.currentGesture || GESTURES.NONE;
}

function isFingerExtended(lm, tipIdx, baseIdx) {
  const tip = lm[tipIdx], base = lm[baseIdx];
  return tip.y < base.y - 0.04;
}

function isThumbExtended(lm) {
  const tip = lm[4], base = lm[2];
  return Math.abs(tip.x - base.x) > 0.05;
}

function displayGestureName(g) {
  const map = { 'none': 'Tidak ada', 'fist': 'Saturnus', 'open': 'Terbuka', 'peace': 'Teks', 'metal': 'Hati' };
  return map[g] || g;
}

// ---- UI Helpers (force shapes etc) ----
function forceShape(shape) {
  state.currentGesture = shape;
  state.isForcedShape = true;
  if (state.forcedShapeTimer) clearTimeout(state.forcedShapeTimer);
  state.forcedShapeTimer = setTimeout(() => { state.isForcedShape = false; state.currentGesture = GESTURES.NONE; }, 4500);
  const statusEl = document.getElementById('status');
  if (statusEl) {
    statusEl.textContent = `Manual: ${displayGestureName(shape)}`;
    statusEl.classList.add('detected');
  }
}

// Expose small API for index.html buttons
window.forceShape = forceShape;
window.saveText = (txt) => { state.customText = (txt || 'I LOVE U').toString(); };
