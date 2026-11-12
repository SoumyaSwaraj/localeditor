/* TEST ONLY — never loaded in production. A mock of the LE.fx registry (docs/EXPERT-MODE.md "Effect registry") with at
 * least one effect per parameter type, so the workspace, the generated panels and the control kit are fully exercised
 * before the real renderer lands. Loaded by tests/expert-ui.test.js and labs/expert-controls/. The workspace uses it only
 * when LE.fx is absent. Nothing is rendered: passes() is a no-op. */
(function (global) {
  'use strict';
  var list = [];
  var calls = { interactive: [] };
  function reg(r) { r.version = r.version || 1; r.space = r.space || 'linear'; r.needs = r.needs || []; r.support = r.support || { needs: ['webgl2'] }; r.passes = function () {}; r.radius = function () { return 0; }; list.push(r); }
  function n(min, max, def, step, label, extra) { return Object.assign({ type: 'number', min: min, max: max, default: def, step: step, label: label }, extra || {}); }
  var W0 = { h: 0, a: 0, l: 0 };

  reg({ id: 'mock.light', name: 'Light', group: 'light', ui: { section: 'Light' },
    params: { exposure: n(-5, 5, 0, 0.01, 'Exposure', { unit: 'EV' }), contrast: n(-100, 100, 0, 1, 'Contrast'), highlights: n(-100, 100, 0, 1, 'Highlights'), shadows: n(-100, 100, 0, 1, 'Shadows'), whites: n(-100, 100, 0, 1, 'Whites'), blacks: n(-100, 100, 0, 1, 'Blacks') },
    agent: { summary: 'Exposure and tone.' } });
  reg({ id: 'mock.wb', name: 'White balance and presence', group: 'color', ui: { section: 'Colour', controls: [{ heading: 'White balance' }, 'temperature', 'tint', { heading: 'Presence' }, 'vibrance', 'saturation'] },
    params: { temperature: n(-100, 100, 0, 1, 'Temperature'), tint: n(-100, 100, 0, 1, 'Tint'), vibrance: n(-100, 100, 0, 1, 'Vibrance'), saturation: n(-100, 100, 0, 1, 'Saturation', { ui: { gradient: 'saturation' } }) },
    agent: { summary: 'Temperature, tint and saturation.' } });
  reg({ id: 'mock.curves', name: 'Curves', group: 'curves', ui: { section: 'Curves' },
    params: { curve: { type: 'curve', label: 'Tone curve', default: { master: [[0, 0], [1, 1]], r: [[0, 0], [1, 1]], g: [[0, 0], [1, 1]], b: [[0, 0], [1, 1]] } } },
    agent: { summary: 'Point curves for RGB and each channel.' } });
  reg({ id: 'mock.hsl', name: 'Colour mixer', group: 'hsl', ui: { section: 'Colour mixer' },
    params: { bands: { type: 'bands', label: 'Bands', min: -100, max: 100 } },
    agent: { summary: 'Hue, saturation and luminance by colour band.' } });
  reg({ id: 'mock.mixer', name: 'Channel mixer', group: 'mixer', ui: { section: 'Colour mixer', controls: [{ control: 'mixer', rows: { r: ['rr', 'rg', 'rb'], g: ['gr', 'gg', 'gb'], b: ['br', 'bg', 'bb'] } }, 'mono'] },
    params: { rr: n(-200, 200, 100, 1, 'Red from red', { unit: '%' }), rg: n(-200, 200, 0, 1, 'Red from green', { unit: '%' }), rb: n(-200, 200, 0, 1, 'Red from blue', { unit: '%' }),
      gr: n(-200, 200, 0, 1, 'Green from red', { unit: '%' }), gg: n(-200, 200, 100, 1, 'Green from green', { unit: '%' }), gb: n(-200, 200, 0, 1, 'Green from blue', { unit: '%' }),
      br: n(-200, 200, 0, 1, 'Blue from red', { unit: '%' }), bg: n(-200, 200, 0, 1, 'Blue from green', { unit: '%' }), bb: n(-200, 200, 100, 1, 'Blue from blue', { unit: '%' }),
      mono: { type: 'bool', default: false, label: 'Monochrome' } },
    agent: { summary: 'Rebuild each channel from the others.' } });
  reg({ id: 'mock.grade', name: 'Colour grading', group: 'grading', ui: { section: 'Colour grading', controls: [{ control: 'wheels', params: ['shadows', 'midtones', 'highlights', 'global'], global: 'global', balance: 'balance', blending: 'blending' }] },
    params: { shadows: { type: 'wheel', label: 'Shadows', default: W0 }, midtones: { type: 'wheel', label: 'Midtones', default: W0 }, highlights: { type: 'wheel', label: 'Highlights', default: W0 }, global: { type: 'wheel', label: 'Global', default: W0 },
      balance: n(-100, 100, 0, 1, 'Balance'), blending: n(0, 100, 50, 1, 'Blending') },
    agent: { summary: 'Tint shadows, midtones and highlights.' } });
  reg({ id: 'mock.lut', name: 'Look (LUT)', group: 'lut', ui: { section: 'Colour grading' },
    params: { lut: { type: 'lut', label: 'LUT', default: null }, amount: n(0, 100, 100, 1, 'Amount', { unit: '%' }) },
    agent: { summary: 'Apply a 3D .cube look.' } });
  reg({ id: 'mock.detail', name: 'Sharpening', group: 'detail', ui: { section: 'Detail' },
    params: { amount: n(0, 150, 0, 1, 'Amount'), radius: n(0.5, 3, 1, 0.1, 'Radius', { unit: 'px' }), detail: n(0, 100, 25, 1, 'Detail'), masking: n(0, 100, 0, 1, 'Masking') },
    agent: { summary: 'Sharpen edges.' } });
  reg({ id: 'mock.vignette', name: 'Vignette', group: 'optics', ui: { section: 'Optics', controls: ['amount', 'midpoint', 'roundness', 'feather', 'center', 'style', { param: 'highlights', when: { style: 'highlight' } }] },
    params: { amount: n(-100, 100, 0, 1, 'Amount'), midpoint: n(0, 100, 50, 1, 'Midpoint'), roundness: n(-100, 100, 0, 1, 'Roundness'), feather: n(0, 100, 50, 1, 'Feather'),
      center: { type: 'point', label: 'Centre', default: { x: 0.5, y: 0.5 } },
      style: { type: 'choice', label: 'Style', default: 'highlight', options: [{ value: 'highlight', label: 'Highlight' }, { value: 'color', label: 'Colour' }, { value: 'paint', label: 'Paint' }] },
      highlights: n(0, 100, 0, 1, 'Protect highlights') },
    agent: { summary: 'Darken or lighten the edges.' } });
  reg({ id: 'mock.perspective', name: 'Perspective', group: 'geometry', ui: { section: 'Geometry', controls: [{ control: 'line', params: ['v1', 'v2'], label: 'Vertical guide', style: 'line' }, 'rotate', 'mode'] },
    params: { v1: { type: 'point', label: 'Top', default: { x: 0.5, y: 0.1 } }, v2: { type: 'point', label: 'Bottom', default: { x: 0.5, y: 0.9 } }, rotate: { type: 'angle', label: 'Rotate', min: -45, max: 45, default: 0, step: 0.1 },
      mode: { type: 'choice', label: 'Fix', default: 'auto', options: [{ value: 'auto', label: 'Auto' }, { value: 'level', label: 'Level' }, { value: 'vertical', label: 'Vertical' }, { value: 'full', label: 'Full' }, { value: 'guided', label: 'Guided' }] } },
    agent: { summary: 'Straighten converging lines.' } });
  reg({ id: 'mock.grain', name: 'Grain', group: 'effects', ui: { section: 'Effects' },
    params: { amount: n(0, 100, 0, 1, 'Amount'), size: n(0, 100, 25, 1, 'Size'), roughness: n(0, 100, 50, 1, 'Roughness'), seed: { type: 'seed', label: 'Seed', default: 7 } },
    agent: { summary: 'Film-like grain, seeded.' } });
  reg({ id: 'mock.glow', name: 'Glow', group: 'effects', ui: { section: 'Effects' },
    params: { threshold: n(0, 4, 1, 0.01, 'Threshold'), radius: n(0, 200, 40, 1, 'Radius', { unit: 'px' }), color: { type: 'color', label: 'Colour', default: '#ffd9a0' }, screen: { type: 'bool', label: 'Screen blend', default: true } },
    agent: { summary: 'Soft glow around bright areas.' } });
  reg({ id: 'mock.light-dir', name: 'Cast shadow', group: 'shadows', ui: { section: 'Shadows & reflections' },
    params: { direction: { type: 'angle', label: 'Light direction', default: 135 }, source: { type: 'point', label: 'Light position', default: { x: 0.2, y: 0.1 } }, color: { type: 'color', label: 'Shadow colour', default: '#1a1420' }, softness: n(0, 100, 30, 1, 'Softness') },
    agent: { summary: 'A shadow cast by a directional light.' } });

  global.LE_FX_MOCK = {
    mock: true,
    describe: function (id) { return id ? list.filter(function (r) { return r.id === id; })[0] || null : list.slice(); },
    register: function (r) { reg(r); },
    interactive: function (on) { calls.interactive.push(!!on); },
    _calls: calls
  };
})(window);
