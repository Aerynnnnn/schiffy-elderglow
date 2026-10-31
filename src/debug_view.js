// Elderglow map debug view (index.html?debug=1): the map drawn from data (ElderMap), role filter, cameras, live stats.
// Same renderer setup, lights, fog and shadow box as the Asset Library's viewer.html, so the two can be compared at the
// same camera. URL: ?cam=aerial|street|tree  ?phone=1 (phone preset: 375x812 canvas, pixel ratio 1.5, 2048 shadows,
// no outlines)  ?empty=1 (start with only the tree + terrain)  ?lib=<url of the library's glb/ folder>
(function () {
const panelHtml = `<div id="panel" class="dbg">
  <h3><span id="title">Elderglow map (debug)</span> <button id="minBtn">_</button></h3>
  <div id="body">
    <div id="roles"></div>
    <div><button id="allBtn">all</button><button id="emptyBtn">nearly empty</button><button id="inkBtn">outlines: on</button></div>
    <div><button data-cam="home">home</button><button data-cam="aerial">aerial</button><button data-cam="street">street</button><button data-cam="tree">tree</button></div>
    <div id="stats">loading...</div>
  </div>
</div>`;
document.body.insertAdjacentHTML('beforeend', panelHtml);
const Q = new URLSearchParams(location.search);
const PHONE = Q.get('phone') === '1' || matchMedia('(pointer: coarse)').matches;
const FIXW = Q.get('phone') === '1' ? 375 : 0, FIXH = Q.get('phone') === '1' ? 812 : 0;
const W = () => FIXW || innerWidth, H = () => FIXH || innerHeight;
const LIB = Q.get('lib') || '../Schiffy%20Asset%20Library/glb/';
const renderer = new THREE.WebGLRenderer({ antialias: !PHONE });
renderer.setPixelRatio(FIXW ? 1.5 : Math.min(devicePixelRatio, PHONE ? 1.5 : 2)); renderer.setSize(W(), H());
renderer.outputEncoding = THREE.sRGBEncoding; renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0xc3dcf7); scene.fog = new THREE.Fog(0xc3dcf7, 400, 1200);
const camera = new THREE.PerspectiveCamera(40, W() / H(), 0.5, 3000);
const controls = new THREE.OrbitControls(camera, renderer.domElement); controls.enableDamping = true;
scene.add(new THREE.HemisphereLight(0xeaf4ff, 0x8a7aa8, 0.75));
const sun = new THREE.DirectionalLight(0xfff4e0, 0.95); sun.castShadow = true;
sun.shadow.mapSize.set(PHONE ? 2048 : 4096, PHONE ? 2048 : 4096); sun.shadow.bias = -0.0006; scene.add(sun);
const $ = id => document.getElementById(id);
let map = null, inkOn = !PHONE, home = null;
$('minBtn').onclick = () => $('panel').classList.toggle('min');

function setCam(name) {
  const L = map.layout, c = L.cameras[name];
  if (name === 'home' || !c) { camera.position.copy(home.eye); controls.target.copy(home.target); }
  else { camera.position.fromArray(c.eye); controls.target.fromArray(c.target); }
  controls.update();
}
document.querySelectorAll('[data-cam]').forEach(b => b.onclick = () => setCam(b.dataset.cam));

ElderMap.load({ base: LIB, scene, lite: PHONE, log: s => $('stats').textContent = s }).then(m => {
  map = m; window.__map = m;
  if (PHONE) m.cull.px = 1.5;
  // fog, camera and the sun's shadow box from the map bounds, exactly like viewer.html does for the baked GLB
  const c = m.box.getCenter(new THREE.Vector3()), r = m.box.getSize(new THREE.Vector3()).length() / 2;
  home = { target: c.clone(), eye: c.clone().add(new THREE.Vector3(-0.75, 0.55, 0.9).multiplyScalar(r * 1.15)) };
  scene.fog.near = r * 1.6; scene.fog.far = r * 5; camera.far = r * 8; camera.updateProjectionMatrix();
  const sc = sun.shadow.camera, s = Math.min(r, 450); Object.assign(sc, { left: -s, right: s, top: s, bottom: -s, far: r * 4 });
  sun.position.copy(c).add(new THREE.Vector3(-0.5, 1, 0.35).multiplyScalar(r * 1.2)); sun.target.position.copy(c); scene.add(sun.target); sc.updateProjectionMatrix();
  // role checkboxes
  const box = $('roles');
  for (const role of Object.keys(m.roles).sort()) {
    const l = document.createElement('label'); l.innerHTML = `<input type="checkbox" checked data-role="${role}"> ${role} <small>(${m.roles[role]})</small>`;
    l.querySelector('input').onchange = e => m.setRole(role, e.target.checked); box.appendChild(l);
  }
  const setAll = keep => box.querySelectorAll('input').forEach(i => { i.checked = keep(i.dataset.role); m.setRole(i.dataset.role, i.checked); });
  $('allBtn').onclick = () => setAll(() => true);
  $('emptyBtn').onclick = () => setAll(r => ['tree', 'ground', 'water', 'rim', 'paths', 'cliff', 'mountain'].includes(r));
  if (Q.get('empty') === '1') $('emptyBtn').onclick();
  const setInk = v => { inkOn = v; m.batches.forEach(b => { if (b.inkMesh) b.inkMesh.material.visible = v; }); $('inkBtn').textContent = 'outlines: ' + (v ? 'on' : 'off'); };
  $('inkBtn').onclick = () => setInk(!inkOn); setInk(inkOn);
  setCam(Q.get('cam') || 'home');
  m.readyAt = performance.now();
  if (m.missing.length || m.missingKids.length) { $('err').style.display = 'block'; $('err').textContent = 'not in the kit GLBs: ' + m.missing.concat(m.missingKids).join(', '); }
}).catch(e => { $('err').style.display = 'block'; $('err').textContent = 'Could not load the map: ' + (e.stack || e); window.__mapError = String(e); });

addEventListener('resize', () => { camera.aspect = W() / H(); camera.updateProjectionMatrix(); renderer.setSize(W(), H()); });
const clock = new THREE.Clock(); let frames = 0, acc = 0, fps = 0, cpu = 0;
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta(), t = clock.elapsedTime; controls.update();
  const t0 = performance.now();
  if (map) map.update(camera, t, renderer.domElement.height);
  renderer.render(scene, camera);
  cpu += performance.now() - t0; frames++; acc += dt;
  if (acc >= 0.5 && map) {
    fps = frames / acc; const i = renderer.info.render, st = map.stats;
    window.__perf = { fps, cpuMs: cpu / frames, calls: i.calls, tris: i.triangles, drawn: st.drawn, instances: st.instances, loadMs: Math.round(map.readyAt || 0) };
    $('stats').textContent = `fps ${fps.toFixed(0)}  cpu ${(cpu / frames).toFixed(1)} ms\ndraw calls ${i.calls}\ntris ${(i.triangles / 1e6).toFixed(2)} M\ninstances ${st.drawn} / ${st.instances}\nloaded in ${(map.readyAt / 1000).toFixed(1)} s`;
    frames = 0; acc = 0; cpu = 0;
  }
});
})();
