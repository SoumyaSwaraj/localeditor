/* Quick maker: screenshot and code beautifier (2.8). A screenshot (pasted, dropped or picked) or a piece of code becomes a
   framed, share-ready design on a backdrop, made of ordinary layers: backdrop shapes, a generic window or device drawn
   from shapes, the screenshot as a photo slot, and code as one text layer per colour (a small built-in highlighter).
   Frames are generic: neutral dots, a plain address pill, an even bezel and a round camera dot. No real product's
   outline, buttons or marks. Everything the person chose lives in doc.maker, so Edit details remakes it in one step. */
(function () {
  'use strict';
  var LE = window.LE;
  if (!LE || !LE.makers) return;
  var MK = LE.makers;

  /* ---------- A tiny syntax highlighter ----------
     highlight(code, lang) → { lang, lines: [[{ t: text, c: class }]] }. Classes: plain comment keyword string number
     func type punct. Markup tags count as keyword, attributes as func, so every language maps onto the same eight colours. */
  var KW = {
    js: 'await break case catch class const continue debugger default delete do else export extends finally for from function get if import in instanceof let new of return set static super switch this throw try typeof var void while with yield async true false null undefined NaN Infinity',
    ts: 'abstract as declare enum implements interface keyof namespace private protected public readonly type any boolean number string unknown never',
    py: 'and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield True False None self',
    sh: 'if then else elif fi for while until do done case esac in function return local export readonly unset shift exit echo cd source alias set',
    sql: 'select from where and or not insert into values update set delete create table index view drop alter add join left right inner outer full on as group by order having limit offset distinct union all case when then else end null is in like between primary key foreign references default exists count sum avg min max asc desc with returning',
    go: 'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var true false nil iota',
    rust: 'as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while Some None Ok Err',
    c: 'auto break case char const continue default do double else enum extern float for goto if inline int long register return short signed sizeof static struct switch typedef union unsigned void volatile while bool true false nullptr class public private protected virtual template typename namespace using new delete this throw try catch include define',
    java: 'abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for if implements import instanceof int interface long native new package private protected public return short static super switch synchronized this throw throws try void volatile while true false null var val fun when object override suspend data sealed companion lateinit is',
    swift: 'associatedtype class deinit enum extension func import init inout internal let operator private protocol public static struct subscript typealias var break case continue default defer do else fallthrough for guard if in repeat return switch where while as catch false is nil super self Self throw throws true try async await',
    php: 'abstract and array as break callable case catch class clone const continue declare default do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile extends final finally fn for foreach function global goto if implements include instanceof insteadof interface isset list match namespace new or print private protected public require return static switch throw trait try unset use var while yield true false null',
    rb: 'alias and begin break case class def defined do else elsif end ensure false for if in module next nil not or redo rescue retry return self super then true undef unless until when while yield puts require attr_accessor'
  };
  var LANGS = [
    { id: 'auto', name: 'Detect it' }, { id: 'js', name: 'JavaScript' }, { id: 'ts', name: 'TypeScript' }, { id: 'py', name: 'Python' },
    { id: 'html', name: 'HTML or XML' }, { id: 'css', name: 'CSS' }, { id: 'json', name: 'JSON' }, { id: 'sh', name: 'Shell' }, { id: 'sql', name: 'SQL' },
    { id: 'go', name: 'Go' }, { id: 'rust', name: 'Rust' }, { id: 'c', name: 'C or C++' }, { id: 'java', name: 'Java or Kotlin' }, { id: 'swift', name: 'Swift' },
    { id: 'php', name: 'PHP' }, { id: 'rb', name: 'Ruby' }, { id: 'plain', name: 'Plain text' }
  ];
  var kwSets = {};
  function kw(lang) {
    if (kwSets[lang]) return kwSets[lang];
    var words = (KW[lang] || '') + (lang === 'ts' ? ' ' + KW.js : '');
    var set = Object.create(null);
    words.split(/\s+/).forEach(function (w) { if (w) set[lang === 'sql' ? w.toLowerCase() : w] = 1; });
    kwSets[lang] = set;
    return set;
  }
  function detect(code) {
    var s = String(code || '');
    var t = s.replace(/^\s+/, '');
    if (/^<(!doctype|[a-z][\w-]*[\s>/]|\?xml|!--)/i.test(t) && /<\/[\w-]+>|\/>/.test(s)) return 'html';
    if (/^[{\[]/.test(t)) { try { JSON.parse(s); return 'json'; } catch (e) { /* not JSON */ } }
    if (/^\s*(def |class \w+(\(.*\))?:|from \w[\w.]* import |import \w+\s*$|@\w+\s*$)/m.test(s) || /\belif\b|\bself\.|print\(/.test(s) && !/[;{}]\s*$/m.test(s)) return 'py';
    if (/^\s*(select|insert into|update \w+ set|create table|with \w+ as)\b/im.test(s)) return 'sql';
    if (/^#!.*\b(ba|z)?sh\b/.test(t) || /^\s*(\$ |sudo |npm |git |cd |echo |export \w+=)/m.test(s) || /\bfi\b|\besac\b/.test(s)) return 'sh';
    if (/^\s*package \w+\s*$/m.test(s) || /\bfunc (\(\w+ \*?\w+\) )?\w+\(/.test(s) || /:=/.test(s) && /\bfunc\b/.test(s)) return 'go';
    if (/\bfn \w+\s*[(<]/.test(s) || /\blet mut\b|\bimpl\b.*\{|::<|println!/.test(s)) return 'rust';
    if (/<\?php/.test(s) || /\$\w+\s*=.*;\s*$/m.test(s) && /\bfunction\b|\becho\b/.test(s)) return 'php';
    if (/^\s*#include\b|\bstd::|\bint main\s*\(/m.test(s)) return 'c';
    if (/\bpublic (static )?(class|void)\b|\bSystem\.out\b|\bfun \w+\(|\bval \w+\s*[:=]/.test(s)) return 'java';
    if (/\bfunc \w+\(.*\)\s*(->|\{)|\bguard let\b|\bimport (SwiftUI|Foundation)\b/.test(s)) return 'swift';
    if (/^\s*def \w+|\bend\s*$|\bputs\b|\.each do\b/m.test(s) && !/[;{}]\s*$/m.test(s)) return 'rb';
    if (/^\s*[.#@]?[\w-][\w\s.#:>,-]*\{\s*$/m.test(s) && /^\s*[\w-]+\s*:\s*[^;]+;\s*$/m.test(s)) return 'css';
    if (/\binterface \w+|:\s*(string|number|boolean|void)\b|\btype \w+\s*=|<\w+>\(/.test(s)) return 'ts';
    if (/\b(const|let|var|function|=>|import|export|return)\b|[;{}]\s*$/m.test(s)) return 'js';
    return 'plain';
  }
  function family(lang) {
    if (lang === 'py' || lang === 'rb' || lang === 'sh') return 'hash';
    if (lang === 'sql') return 'sql';
    return 'c';
  }
  /* Scans a whole piece of code into tokens (comments and strings may span lines), then splits them into lines. */
  function scan(code, lang) {
    var out = [];
    function push(t, c) { if (t) out.push({ t: t, c: c }); }
    var s = String(code), i = 0, n = s.length;
    var m;
    function at(re) { re.lastIndex = i; var r = re.exec(s); return r && r.index === i ? r[0] : null; }
    if (lang === 'plain') { push(s, 'plain'); return out; }
    if (lang === 'html') {
      var inTag = false;
      while (i < n) {
        if (!inTag) {
          if ((m = at(/<!--[\s\S]*?(-->|$)/g))) { push(m, 'comment'); i += m.length; continue; }
          if ((m = at(/<[!?/]?[A-Za-z][\w:.-]*/g))) { push(m.slice(0, m.search(/[A-Za-z]/)), 'punct'); push(m.slice(m.search(/[A-Za-z]/)), 'keyword'); i += m.length; inTag = true; continue; }
          if ((m = at(/&[#\w]+;/g))) { push(m, 'number'); i += m.length; continue; }
          m = at(/[^<&]+|[<&]/g); push(m, 'plain'); i += m.length; continue;
        }
        if ((m = at(/\/?\??>/g))) { push(m, 'punct'); i += m.length; inTag = false; continue; }
        if ((m = at(/"[^"]*"?|'[^']*'?/g))) { push(m, 'string'); i += m.length; continue; }
        if ((m = at(/[A-Za-z_:@][\w:.@-]*/g))) { push(m, 'func'); i += m.length; continue; }
        if ((m = at(/=/g))) { push(m, 'punct'); i += 1; continue; }
        m = at(/\s+|[^\s]/g); push(m, 'plain'); i += m.length;
      }
      return out;
    }
    if (lang === 'css') {
      var depth = 0;
      while (i < n) {
        if ((m = at(/\/\*[\s\S]*?(\*\/|$)/g))) { push(m, 'comment'); i += m.length; continue; }
        if ((m = at(/"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?/g))) { push(m, 'string'); i += m.length; continue; }
        if ((m = at(/@[\w-]+/g))) { push(m, 'keyword'); i += m.length; continue; }
        if ((m = at(/#[0-9a-fA-F]{3,8}\b/g)) && depth) { push(m, 'number'); i += m.length; continue; }
        if ((m = at(/-?\d*\.?\d+(%|[a-z]+)?/gi)) && depth) { push(m, 'number'); i += m.length; continue; }
        if ((m = at(/[\w-]+(?=\s*:)/g)) && depth) { push(m, 'func'); i += m.length; continue; }
        if ((m = at(/[\w-]+(?=\()/g))) { push(m, 'type'); i += m.length; continue; }
        if ((m = at(/[.#][\w-]+|:{1,2}[\w-]+/g)) && !depth) { push(m, 'type'); i += m.length; continue; }
        if ((m = at(/[\w-]+/g))) { push(m, depth ? 'plain' : 'keyword'); i += m.length; continue; }
        m = at(/\s+|[^\s]/g);
        if (m === '{') depth++; else if (m === '}') depth = Math.max(0, depth - 1);
        push(m, /\s/.test(m) ? 'plain' : 'punct'); i += m.length;
      }
      return out;
    }
    if (lang === 'json') {
      while (i < n) {
        if ((m = at(/"(?:\\.|[^"\\\n])*"?/g))) { var key = /^\s*:/.test(s.slice(i + m.length, i + m.length + 40)); push(m, key ? 'func' : 'string'); i += m.length; continue; }
        if ((m = at(/-?\d+(\.\d+)?([eE][+-]?\d+)?/g))) { push(m, 'number'); i += m.length; continue; }
        if ((m = at(/\b(true|false|null)\b/g))) { push(m, 'keyword'); i += m.length; continue; }
        m = at(/\s+|[^\s]/g); push(m, /\s/.test(m) ? 'plain' : 'punct'); i += m.length;
      }
      return out;
    }
    var fam = family(lang), words = kw(lang);
    while (i < n) {
      var ch = s.charAt(i);
      if (fam === 'hash' && ch === '#' && !(lang === 'sh' && s.charAt(i - 1) === '$')) {
        m = at(/#.*/g); push(m, 'comment'); i += m.length; continue;
      }
      if (fam === 'sql' && (m = at(/--.*/g))) { push(m, 'comment'); i += m.length; continue; }
      if (fam !== 'hash' && (m = at(/\/\/.*|\/\*[\s\S]*?(\*\/|$)/g))) { push(m, 'comment'); i += m.length; continue; }
      if (lang === 'php' && ch === '#' && (m = at(/#(?!\[).*/g))) { push(m, 'comment'); i += m.length; continue; }
      if (lang === 'py' && (m = at(/[rbfuRBFU]{0,2}("""|''')[\s\S]*?(\1|$)/g))) { push(m, 'string'); i += m.length; continue; }
      if ((m = at(/[rbfuRBFU]{0,2}"(?:\\.|[^"\\\n])*"?|[rbfuRBFU]{0,2}'(?:\\.|[^'\\\n])*'?/g)) && (lang === 'py' || /^["']/.test(m))) {
        if (lang === 'rust' && /^'.'?$/.test(m) === false && /^'[A-Za-z_]\w*$/.test(m)) { /* a lifetime, not a string */ } else { push(m, 'string'); i += m.length; continue; }
      }
      if ((fam === 'c' || lang === 'sh') && ch === '`' && (m = at(/`(?:\\.|[^`\\])*`?/g))) { push(m, 'string'); i += m.length; continue; }
      if (lang === 'sh' && (m = at(/\$\{[^}\n]*\}?|\$[\w@#?$!*-]/g))) { push(m, 'type'); i += m.length; continue; }
      if ((lang === 'php' || lang === 'rb') && (m = at(/[$@]{1,2}[A-Za-z_]\w*/g))) { push(m, 'type'); i += m.length; continue; }
      if ((m = at(/\b(0[xX][\da-fA-F_]+|0[bB][01_]+|\d[\d_]*(\.\d[\d_]*)?([eE][+-]?\d+)?[a-zA-Z]{0,3})\b/g))) { push(m, 'number'); i += m.length; continue; }
      if ((m = at(/@[A-Za-z_][\w.]*/g)) && (lang === 'py' || lang === 'java' || lang === 'ts' || lang === 'js' || lang === 'swift')) { push(m, 'func'); i += m.length; continue; }
      if ((m = at(/[A-Za-z_$][\w$]*!?/g))) {
        var bare = m.replace(/!$/, '');
        if (words[lang === 'sql' ? bare.toLowerCase() : bare]) push(m, 'keyword');
        else if (/^\s*\(/.test(s.slice(i + m.length, i + m.length + 20)) || /!$/.test(m)) push(m, 'func');
        else if (/^[A-Z][a-z0-9]\w*$/.test(bare) && lang !== 'sql') push(m, 'type');
        else push(m, 'plain');
        i += m.length; continue;
      }
      m = at(/\s+|[^\s]/g);
      push(m, /\s/.test(m) ? 'plain' : 'punct');
      i += m.length;
    }
    return out;
  }
  function highlight(code, lang) {
    code = String(code == null ? '' : code).replace(/\r\n?/g, '\n').replace(/\t/g, '  ');
    if (!lang || lang === 'auto' || !LANGS.some(function (l) { return l.id === lang; })) lang = detect(code);
    var toks = scan(code, lang), lines = [[]];
    toks.forEach(function (tk) {
      var parts = tk.t.split('\n');
      parts.forEach(function (p, i) {
        if (i) lines.push([]);
        if (p) lines[lines.length - 1].push({ t: p, c: tk.c });
      });
    });
    return { lang: lang, lines: lines };
  }

  /* ---------- Colours ---------- */
  var CLASSES = ['plain', 'punct', 'comment', 'keyword', 'string', 'number', 'func', 'type'];
  var CLASS_NAMES = { plain: 'Code', punct: 'Code punctuation', comment: 'Code comments', keyword: 'Code keywords', string: 'Code strings', number: 'Code numbers', func: 'Code names', type: 'Code types' };
  var THEMES = {
    dark: { bg: '#15171C', bar: '#1C1F26', line: '#2A2E37', edge: '#2E323B', dots: '#4A4F5B', title: '#9AA1AD', nums: '#6B7280',
      ink: { plain: '#E4E6EB', punct: '#AEB4BF', comment: '#8E96A3', keyword: '#FF7AB6', string: '#9EE493', number: '#FFB86B', func: '#7CC4FF', type: '#CBA6FF' } },
    light: { bg: '#FFFFFF', bar: '#F4F5F7', line: '#E4E6EA', edge: '#DCDFE4', dots: '#C4C8CF', title: '#5B616B', nums: '#8A9099',
      ink: { plain: '#1F2328', punct: '#4D5560', comment: '#6A737D', keyword: '#C21E6B', string: '#1A7F37', number: '#B35100', func: '#0B5FC2', type: '#7A3EBD' } }
  };
  var PALETTES = [
    { id: 'dusk', name: 'Dusk', colors: ['#2E2A7A', '#6D4BD8', '#E58BB8'], base: '#ECE8FA' },
    { id: 'ocean', name: 'Ocean', colors: ['#0B3B6E', '#1C7ED6', '#74D4E8'], base: '#E4F1FA' },
    { id: 'peach', name: 'Peach', colors: ['#E8785A', '#F5A97F', '#FBDDBE'], base: '#FFF1E7' },
    { id: 'mint', name: 'Mint', colors: ['#0E6B5C', '#2FB38F', '#B8F0D9'], base: '#E6F6EF' },
    { id: 'sunset', name: 'Sunset', colors: ['#D9344A', '#F2711C', '#FFC53D'], base: '#FFF0E4' },
    { id: 'berry', name: 'Berry', colors: ['#6E1A54', '#C2306F', '#F59AB3'], base: '#FBE8EF' },
    { id: 'slate', name: 'Slate', colors: ['#1F2933', '#3E4C59', '#8B98A6'], base: '#E9ECEF' },
    { id: 'night', name: 'Night', colors: ['#0B0D17', '#1D2145', '#4A3F9A'], base: '#14161F' }
  ];
  function paletteOf(id) { for (var i = 0; i < PALETTES.length; i++) if (PALETTES[i].id === id) return PALETTES[i]; return PALETTES[0]; }

  var FRAMES = [{ id: 'none', name: 'No frame' }, { id: 'browser', name: 'Browser window' }, { id: 'desktop', name: 'Desktop window' }, { id: 'phone', name: 'Phone' }, { id: 'tablet', name: 'Tablet' }];
  var PAD = { small: 0.065, medium: 0.1, large: 0.15 };
  var CORNER = { square: 0, soft: 1.3, round: 2.6 };

  MK.highlight = highlight;
  MK.highlightLanguages = LANGS.map(function (l) { return l.id; });

  MK.register({
    id: 'beautify',
    name: 'Screenshot beautifier',
    category: 'Social',
    summary: 'Paste a screenshot or some code; get a framed image on a soft backdrop, ready to post.',
    keywords: ['screenshot', 'beautify', 'code', 'snippet', 'code image', 'window', 'browser window', 'phone', 'tablet', 'mockup', 'frame', 'backdrop', 'gradient', 'share', 'post', 'paste', 'developer', 'syntax'],
    sizes: [
      { id: 'square', name: 'Square', w: 1080, h: 1080 },
      { id: 'portrait', name: '4:5', w: 1080, h: 1350 },
      { id: 'wide', name: '16:9', w: 1920, h: 1080 },
      { id: 'story', name: 'Story', w: 1080, h: 1920 }
    ],
    inputs: [
      { key: 'mode', label: 'What to show', type: 'choice', options: [{ id: 'shot', name: 'Screenshot' }, { id: 'code', name: 'Code' }], default: 'shot' },
      { key: 'shot', label: 'Screenshot', type: 'photo', hint: 'Paste it (Ctrl+V or long-press, Paste), drop it here, or pick a file.' },
      { key: 'code', label: 'Code', type: 'longtext', max: 2000, maxLines: 40, placeholder: 'Paste some code', hint: 'Up to 40 lines. Used when “What to show” is Code.' },
      { key: 'lang', label: 'Language', type: 'choice', options: LANGS, default: 'auto' },
      { key: 'frame', label: 'Frame', type: 'choice', options: FRAMES, default: 'browser', hint: 'Code always sits in a plain window; “No frame” drops its title bar.' },
      { key: 'title', label: 'Window title', type: 'text', max: 48, placeholder: 'localeditor.net', hint: 'The address in a browser window, the file name over code.' },
      { key: 'theme', label: 'Window', type: 'choice', options: [{ id: 'light', name: 'Light' }, { id: 'dark', name: 'Dark' }], default: 'light' },
      { key: 'numbers', label: 'Line numbers', type: 'toggle', default: true, hint: 'Show line numbers on code' },
      { key: 'palette', label: 'Backdrop colours', type: 'choice', options: PALETTES.map(function (p) { return { id: p.id, name: p.name }; }), default: 'dusk' },
      { key: 'color', label: 'Own backdrop colour', type: 'color' },
      { key: 'padding', label: 'Space around', type: 'choice', options: [{ id: 'small', name: 'Small' }, { id: 'medium', name: 'Medium' }, { id: 'large', name: 'Large' }], default: 'medium' },
      { key: 'corners', label: 'Corners', type: 'choice', options: [{ id: 'square', name: 'Square' }, { id: 'soft', name: 'Soft' }, { id: 'round', name: 'Round' }], default: 'soft' },
      { key: 'shadow', label: 'Shadow', type: 'choice', options: [{ id: 'none', name: 'None' }, { id: 'soft', name: 'Soft' }, { id: 'deep', name: 'Deep' }], default: 'soft' },
      { key: 'caption', label: 'Headline', type: 'text', max: 70, placeholder: 'Dark mode is here', hint: 'Optional words above the window.' }
    ],
    styles: [
      { id: 'gradient', name: 'Gradient' },
      { id: 'glow', name: 'Soft glow' },
      { id: 'plain', name: 'Plain' },
      { id: 'match', name: 'Match the screenshot' },
      { id: 'dots', name: 'Dot grid' }
    ],
    sample: { values: {
      mode: 'shot', shot: 'sample:screen-01', frame: 'browser', title: 'localeditor.net', theme: 'light', palette: 'dusk', padding: 'medium', corners: 'soft', shadow: 'soft',
      code: 'function greet(name) {\n  // Say hello, politely\n  const when = new Date().getHours() < 12 ? "morning" : "day";\n  return `Good ${when}, ${name}!`;\n}\n\nconsole.log(greet("Ada"));',
      lang: 'auto', numbers: true
    } },
    ui: ui,
    build: build
  });

  function build(v, env) {
    var W = env.W, H = env.H, C = env.color, u = Math.min(W, H) / 100;
    var pal = paletteOf(v.palette);
    var codeMode = v.mode === 'code';
    var theme = THEMES[v.theme === 'dark' ? 'dark' : 'light'];
    var page = env.page('#FFFFFF'), L = [];

    /* ---- Backdrop ---- */
    var cols = pal.colors.slice(), base = pal.base;
    if (v.color) {
      var hs = C.hsl(v.color);
      cols = [C.shade(v.color, 0.35), v.color, C.tint(v.color, 0.45)];
      base = C.tint(v.color, hs[2] < 30 ? 0.1 : 0.82);
      if (C.isDark(v.color) && hs[2] < 20) base = v.color;
    }
    var style = env.style;
    if (style === 'match') {
      var found = !codeMode && v.shot ? env.palette(v.shot, 5) : null;
      if (found && found.length) {
        /* The most colourful sampled colour leads; very grey screenshots get a calm tinted grey. */
        var best = found[0], bs = -1;
        found.forEach(function (c) { var q = C.hsl(c); var score = q[1] * (1 - Math.abs(q[2] - 52) / 60); if (score > bs) { bs = score; best = c; } });
        var lead = C.hsl(best)[1] < 12 ? C.mix(best, pal.colors[1], 0.35) : best;
        cols = [C.shade(lead, 0.42), lead, C.tint(lead, 0.5)];
        base = C.tint(lead, 0.84);
      } else if (codeMode) {
        cols = [C.shade(theme.ink.func, 0.55), C.mix(theme.ink.func, theme.ink.type, 0.5), C.tint(theme.ink.keyword, 0.25)];
        base = C.tint(theme.ink.func, 0.84);
      }
    }
    var mid = C.mix(cols[0], cols[2], 0.5);
    var bgTone = mid;
    if (style === 'gradient' || style === 'match') {
      page.background = { type: 'gradient', kind: 'linear', angle: 135, colors: cols.slice() };
    } else if (style === 'glow') {
      var dark = C.isDark(base);
      page.background = { type: 'color', color: dark ? base : C.tint(base, 0.35) };
      bgTone = page.background.color;
      var spots = [[-0.18, -0.2, 0.95, cols[1]], [0.5, -0.12, 0.8, cols[2]], [-0.1, 0.55, 0.85, cols[2]], [0.55, 0.5, 0.95, cols[0]]];
      spots.forEach(function (s, i) {
        var d = Math.max(W, H) * s[2];
        var jx = (env.random() - 0.5) * 0.08 * W, jy = (env.random() - 0.5) * 0.08 * H;
        L.push(env.ellipse({ id: 'glow', name: 'Glow ' + (i + 1), x: s[0] * W + jx, y: s[1] * H + jy, w: d, h: d,
          fill: { type: 'radial', colors: [C.rgba(s[3], dark ? 0.55 : 0.6), C.rgba(s[3], 0)] } }));
      });
    } else if (style === 'plain') {
      page.background = { type: 'color', color: v.color || base };
      bgTone = page.background.color;
    } else {
      page.background = { type: 'color', color: base };
      bgTone = base;
      var pitch = Math.round(3.2 * u), dot = Math.max(1.6, 0.28 * u);
      var dotC = C.isDark(base) ? C.rgba('#FFFFFF', 0.16) : C.rgba(cols[1], 0.28);
      L.push(env.svg({ id: 'dots', name: 'Dot grid', x: 0, y: 0, w: W, h: H,
        markup: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '"><defs><pattern id="d" width="' + pitch + '" height="' + pitch + '" patternUnits="userSpaceOnUse"><circle cx="' + (pitch / 2) + '" cy="' + (pitch / 2) + '" r="' + dot.toFixed(2) + '" fill="' + dotC + '"/></pattern></defs><rect width="' + W + '" height="' + H + '" fill="url(#d)"/></svg>' }));
      var halo = Math.max(W, H) * 0.9;
      L.push(env.ellipse({ id: 'halo', name: 'Soft light', x: (W - halo) / 2, y: (H - halo) / 2, w: halo, h: halo, fill: { type: 'radial', colors: [C.rgba(cols[2], C.isDark(base) ? 0.3 : 0.45), C.rgba(cols[2], 0)] } }));
    }

    /* ---- Area for the window ---- */
    var top = env.tall ? 220 : 0, bottom = env.tall ? 280 : 0;
    var pad = (PAD[v.padding] || PAD.medium) * Math.min(W, H);
    var box = { x: pad, y: top + pad, w: W - 2 * pad, h: H - top - bottom - 2 * pad };
    if (env.tall) { box.y = top + pad * 0.5; box.h = H - top - bottom - pad; }
    var ink = C.readable(bgTone, ['#FFFFFF', '#14161C']);
    if (style === 'gradient' || style === 'match') {
      /* Text over a gradient must read at both ends. */
      ink = C.contrast('#FFFFFF', cols[0]) >= 4.5 && C.contrast('#FFFFFF', cols[2]) >= 3.2 ? '#FFFFFF' : C.contrast('#14161C', cols[2]) >= 4.5 && C.contrast('#14161C', cols[0]) >= 3 ? '#14161C' : ink;
    }
    var head = null;
    if (v.caption) {
      head = env.text({ id: 'headline', name: 'Headline', text: v.caption, x: box.x, y: box.y, w: box.w, font: 'Plus Jakarta Sans', weight: 800, size: (env.size.id === 'wide' ? 6.2 : 6.6) * u, min: 3.2 * u, maxLines: 2, lineHeight: 1.08, tracking: -0.025, align: 'center', balance: true, color: ink });
      var gap = 4.5 * u;
      box.y += head.h + gap; box.h -= head.h + gap;
    }

    var radius = (CORNER[v.corners] == null ? CORNER.soft : CORNER[v.corners]) * u;
    var shadowKind = v.shadow || 'soft';
    function shadowsFor(id, x, y, w, h, r, fill) {
      var out = [];
      if (shadowKind === 'deep') {
        out.push(env.rect({ id: id + '-ambient', name: 'Shadow', x: x, y: y, w: w, h: h, radius: r, fill: fill, shadow: { color: 'rgba(8,10,20,0.36)', blur: 9 * u, x: 0, y: 4.6 * u } }));
        return { layers: out, own: { color: 'rgba(8,10,20,0.22)', blur: 1.6 * u, x: 0, y: 0.7 * u } };
      }
      if (shadowKind === 'soft') return { layers: out, own: { color: 'rgba(8,10,20,0.24)', blur: 5.5 * u, x: 0, y: 2.2 * u } };
      return { layers: out, own: null };
    }

    var content = codeMode ? codeWindow(v, env, box, theme, radius, shadowsFor) : shotFrame(v, env, box, theme, radius, shadowsFor);
    L = L.concat(content.layers);
    if (head) {
      /* Keep the headline close to the window when the window is shorter than its box. */
      head.y = Math.round(Math.max(top + pad * (env.tall ? 0.5 : 1), content.top - head.h - 4.5 * u));
      L.push(head);
    }
    page.layers = L;
    var what = codeMode ? (v.title || 'code') : (v.title || 'screenshot');
    return { name: 'Beautified ' + what, pages: [page] };
  }

  /* A screenshot in a generic frame, fitted into box without cropping the screenshot. */
  function shotFrame(v, env, box, theme, radius, shadowsFor) {
    var C = env.color, u = Math.min(env.W, env.H) / 100;
    var frame = v.frame || 'browser';
    var size = v.shot ? env.imageSize(v.shot) : null;
    var A = size ? size.w / size.h : (frame === 'phone' ? 0.46 : frame === 'tablet' ? 0.75 : 1.6);
    A = Math.max(0.2, Math.min(5, A));
    /* Frame size as multiples of the screen width sw: total width fw*sw, height fh*sw. */
    var bar = 0, bz = 0, fw = 1, fh = 1 / A;
    if (frame === 'browser') { bar = 0.062; fh += bar; }
    else if (frame === 'desktop') { bar = 0.052; fh += bar; }
    else if (frame === 'phone') { bz = 0.04 * Math.min(1, 1 / A); fw += 2 * bz; fh += 2 * bz; }
    else if (frame === 'tablet') { bz = 0.032 * Math.min(1, 1 / A); fw += 2 * bz; fh += 2 * bz; }
    var sw = Math.min(box.w / fw, box.h / fh);
    /* Bars and bezels must not get silly on very wide screenshots: cap the bar at a sensible size. */
    if (bar) { var barPx = Math.min(bar * sw, 7.2 * u); fh = 1 / A + barPx / sw; sw = Math.min(box.w / fw, box.h / fh); bar = Math.min(bar * sw, 7.2 * u) / sw; }
    var sh = sw / A;
    var tw = fw * sw, th = fh * sw;
    var x = box.x + (box.w - tw) / 2, y = box.y + (box.h - th) / 2;
    var out = [];
    var label = 'Add your screenshot';
    var chrome = theme === THEMES.dark ? THEMES.dark : THEMES.light;

    if (frame === 'none') {
      var sd0 = shadowsFor('screen', x, y, tw, th, radius, '#FFFFFF');
      out = out.concat(sd0.layers);
      var p0 = env.photo({ id: 'screenshot', name: 'Screenshot', src: v.shot, x: x, y: y, w: tw, h: th, radius: radius, label: label, slot: 'screenshot', shadow: sd0.own });
      out.push(p0);
      return { layers: out, top: y };
    }
    if (frame === 'browser' || frame === 'desktop') {
      var bh = bar * sw, r = Math.min(radius, bh * 0.9);
      var sd = shadowsFor('window', x, y, tw, th, r, chrome.bar);
      out = out.concat(sd.layers);
      out.push(env.rect({ id: 'window', name: 'Window', x: x, y: y, w: tw, h: th, radius: r, fill: chrome.bar, stroke: { width: Math.max(1, 0.1 * u), color: chrome.edge }, shadow: sd.own }));
      var dotD = bh * 0.26, dotY = y + (bh - dotD) / 2, dotX = x + bh * 0.42;
      for (var i = 0; i < 3; i++) out.push(env.ellipse({ id: 'window-dot', name: 'Window button ' + (i + 1), x: dotX + i * dotD * 1.75, y: dotY, w: dotD, h: dotD, fill: chrome.dots }));
      var afterDots = dotX + 2 * dotD * 1.75 + dotD;
      if (frame === 'browser') {
        /* Back and forward arrows, then a plain address pill. No padlock, no product marks. */
        var ar = bh * 0.32, ax = afterDots + bh * 0.45, ay = y + (bh - ar) / 2, sw2 = Math.max(1.5, bh * 0.055);
        out.push(env.svg({ id: 'nav', name: 'Back and forward', x: ax, y: ay, w: ar * 2.6, h: ar,
          markup: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 26 10" fill="none" stroke="' + chrome.dots + '" stroke-width="' + (sw2 / ar * 10).toFixed(2) + '" stroke-linecap="round" stroke-linejoin="round"><path d="M6 1 2 5l4 4M20 1l4 4-4 4"/></svg>' }));
        var pillX = ax + ar * 2.6 + bh * 0.45, pillW = Math.min(tw * 0.56, x + tw - bh * 0.6 - pillX);
        pillX = Math.max(pillX, x + (tw - pillW) / 2);
        if (pillX + pillW > x + tw - bh * 0.4) pillW = x + tw - bh * 0.4 - pillX;
        var pillH = bh * 0.6, pillFill = theme === THEMES.dark ? '#262A33' : '#FFFFFF';
        if (pillW > bh * 1.5) {
          out.push(env.rect({ id: 'address-bar', name: 'Address bar', x: pillX, y: y + (bh - pillH) / 2, w: pillW, h: pillH, radius: pillH / 2, fill: pillFill, stroke: theme === THEMES.dark ? null : { width: Math.max(1, 0.08 * u), color: chrome.line } }));
          var addr = v.title || 'localeditor.net';
          var at = env.text({ id: 'address', name: 'Address', text: addr, x: pillX + pillH * 0.5, y: 0, w: pillW - pillH, font: 'Inter', weight: 500, size: pillH * 0.44, min: pillH * 0.3, maxLines: 1, align: 'center', color: C.ensure(chrome.title, pillFill, 4.6) });
          at.y = Math.round(y + (bh - at.h) / 2);
          out.push(at);
        }
      } else if (v.title) {
        var tt = env.text({ id: 'window-title', name: 'Window title', text: v.title, x: x + tw * 0.2, y: 0, w: tw * 0.6, font: 'Inter', weight: 600, size: bh * 0.36, min: bh * 0.24, maxLines: 1, align: 'center', color: C.ensure(chrome.title, chrome.bar, 4.6) });
        tt.y = Math.round(y + (bh - tt.h) / 2);
        out.push(tt);
      }
      var sy = y + bh;
      var rr = Math.max(0, r - 0.5);
      out.push(env.photo({ id: 'screenshot', name: 'Screenshot', src: v.shot, x: x, y: sy, w: sw, h: sh, label: label, slot: 'screenshot', focus: { x: 0.5, y: 0 },
        maskPath: rr > 0.5 ? bottomRound(sw, sh, rr) : null }));
      return { layers: out, top: y };
    }
    /* Phone or tablet: an even bezel, round corners, a round camera dot. */
    var tablet = frame === 'tablet';
    var bzp = bz * sw;
    var bodyR = tablet ? Math.min(tw, th) * 0.055 : Math.min(tw, th) * 0.12;
    var body = theme === THEMES.dark ? '#121317' : '#E8E9ED', edge = theme === THEMES.dark ? '#363A43' : '#C9CCD3';
    var sdp = shadowsFor('device', x, y, tw, th, bodyR, body);
    out = out.concat(sdp.layers);
    out.push(env.rect({ id: 'device', name: tablet ? 'Tablet' : 'Phone', x: x, y: y, w: tw, h: th, radius: bodyR, fill: body, stroke: { width: Math.max(1.5, 0.22 * u), color: edge }, shadow: sdp.own }));
    out.push(env.photo({ id: 'screenshot', name: 'Screenshot', src: v.shot, x: x + bzp, y: y + bzp, w: sw, h: sh, radius: Math.max(0, bodyR - bzp), label: label, slot: 'screenshot', focus: { x: 0.5, y: 0 } }));
    var cam = tablet ? bzp * 0.34 : Math.min(sw, sh) * 0.032;
    var landscape = A > 1;
    var cx, cy;
    if (tablet) { cx = landscape ? x + bzp / 2 : x + tw / 2; cy = landscape ? y + th / 2 : y + bzp / 2; }
    else { cx = landscape ? x + bzp + Math.min(sw, sh) * 0.06 : x + tw / 2; cy = landscape ? y + th / 2 : y + bzp + Math.min(sw, sh) * 0.06; }
    out.push(env.ellipse({ id: 'camera', name: 'Camera', x: cx - cam / 2, y: cy - cam / 2, w: cam, h: cam, fill: theme === THEMES.dark ? '#08090B' : '#2A2C31' }));
    return { layers: out, top: y };
  }
  function bottomRound(w, h, r) {
    var f = function (n) { return Math.round(n * 100) / 100; };
    r = Math.min(r, w / 2, h / 2);
    return 'M0 0H' + f(w) + 'V' + f(h - r) + 'A' + f(r) + ' ' + f(r) + ' 0 0 1 ' + f(w - r) + ' ' + f(h) + 'H' + f(r) + 'A' + f(r) + ' ' + f(r) + ' 0 0 1 0 ' + f(h - r) + 'Z';
  }

  /* Code in a plain window: one text layer per colour, all sharing one grid of lines, so the colours line up exactly in
     a monospaced font. Each line of a colour starts with a zero-width space so its indentation survives wrapping rules. */
  var FONT = 'JetBrains Mono';
  function codeWindow(v, env, box, theme, radius, shadowsFor) {
    var C = env.color, u = Math.min(env.W, env.H) / 100;
    var src = v.code || 'Paste some code';
    var hl = highlight(src, v.lang);
    var lines = hl.lines;
    while (lines.length > 1 && !lines[lines.length - 1].length) lines.pop();
    var numbers = v.numbers !== false;
    var titled = v.frame !== 'none';
    var probe = env.fit({ text: '0000000000', font: FONT, weight: 400, size: 100, w: 100000 });
    var adv = (probe.textWidth || 600) / 1000;
    var lh = 1.55;
    var longest = 1;
    lines.forEach(function (ln) { var n = ln.reduce(function (a, t) { return a + t.t.length; }, 0); if (n > longest) longest = n; });
    var digits = String(lines.length).length;
    function plan(fs) {
      var padX = 1.7 * fs, padY = 1.25 * fs, bar = titled ? 2.5 * fs : 0;
      var gutter = numbers ? (digits + 1.6) * adv * fs : 0;
      var cols = Math.max(8, Math.floor((box.w - 2 * padX - gutter) / (adv * fs * 1.005)));
      var vis = 0;
      lines.forEach(function (ln) {
        var txt = ln.map(function (t) { return t.t; }).join(''), n = txt.length;
        var hang = Math.min(txt.length - txt.replace(/^ +/, '').length + 2, Math.floor(cols / 2));
        vis += n <= cols ? 1 : 1 + Math.ceil((n - cols) / (cols - hang));
      });
      var h = bar + 2 * padY + vis * lh * fs;
      var w = 2 * padX + gutter + Math.min(longest, cols) * adv * fs;
      return { fs: fs, padX: padX, padY: padY, bar: bar, gutter: gutter, cols: cols, vis: vis, w: w, h: h };
    }
    var maxFs = (env.size.id === 'wide' ? 3.8 : 2.9) * u, minFs = 0.9 * u, P = null, fs;
    /* Largest size that fits; but a slightly smaller size that needs no wrapping reads better than wrapped lines. */
    for (fs = maxFs; fs >= minFs; fs -= 0.25) {
      P = plan(Math.round(fs * 4) / 4);
      if (P.h <= box.h && P.w <= box.w) break;
    }
    if (P.vis > lines.length) {
      for (fs = P.fs; fs >= Math.max(minFs, maxFs * 0.72); fs -= 0.25) {
        var Q = plan(Math.round(fs * 4) / 4);
        if (Q.vis === lines.length && Q.h <= box.h && Q.w <= box.w) { P = Q; break; }
      }
    }
    var fsz = P.fs;
    /* Visual rows: long lines wrap at P.cols; continuation rows have no number. */
    var rows = [], nums = [];
    lines.forEach(function (ln, li) {
      var cells = [];
      ln.forEach(function (t) { for (var k = 0; k < t.t.length; k++) cells.push({ ch: t.t.charAt(k), c: t.c }); });
      if (!cells.length) { rows.push([]); nums.push(String(li + 1)); return; }
      /* Wrapped rows continue under the line's own indent, two spaces in. */
      var lead = 0;
      while (lead < cells.length && cells[lead].ch === ' ') lead++;
      var hang = Math.min(lead + 2, Math.floor(P.cols / 2)), first = true;
      for (var s = 0; s < cells.length;) {
        var room = first ? P.cols : P.cols - hang;
        var part = cells.slice(s, s + room);
        if (!first) part = new Array(hang + 1).join(' ').split('').map(function () { return { ch: ' ', c: 'plain' }; }).concat(part);
        rows.push(part); nums.push(first ? String(li + 1) : '');
        s += room; first = false;
      }
    });
    var minW = Math.min(box.w, Math.max(box.w * (env.size.id === 'wide' ? 0.5 : 0.62), 34 * u));
    var ww = Math.max(P.w, minW), wh = P.h;
    if (wh > box.h) wh = box.h;
    var x = box.x + (box.w - ww) / 2, y = box.y + (box.h - wh) / 2;
    var out = [];
    var sd = shadowsFor('window', x, y, ww, wh, radius, theme.bg);
    out = out.concat(sd.layers);
    out.push(env.rect({ id: 'window', name: 'Code window', x: x, y: y, w: ww, h: wh, radius: radius, fill: theme.bg, stroke: { width: Math.max(1, 0.1 * u), color: theme.edge }, shadow: sd.own }));
    if (titled) {
      var bh = P.bar, dotD = bh * 0.27, dotY = y + (bh - dotD) / 2, dotX = x + P.padX * 0.85;
      for (var i = 0; i < 3; i++) out.push(env.ellipse({ id: 'window-dot', name: 'Window button ' + (i + 1), x: dotX + i * dotD * 1.75, y: dotY, w: dotD, h: dotD, fill: theme.dots }));
      if (v.title) {
        var tt = env.text({ id: 'window-title', name: 'Window title', text: v.title, x: x + ww * 0.22, y: 0, w: ww * 0.56, font: 'Inter', weight: 500, size: fsz * 0.92, min: fsz * 0.6, maxLines: 1, align: 'center', color: C.ensure(theme.title, theme.bg, 4.6) });
        tt.y = Math.round(y + (bh - tt.h) / 2);
        out.push(tt);
      }
      out.push(env.line({ id: 'title-rule', name: 'Title bar line', x: x, y: y + bh, w: ww, width: Math.max(1, 0.1 * u), color: theme.line }));
    }
    var codeX = x + P.padX + P.gutter, codeY = y + P.bar + P.padY;
    var group = [];
    var maxCols = 1;
    rows.forEach(function (r) { if (r.length > maxCols) maxCols = r.length; });
    var textW = Math.ceil(maxCols * adv * fsz / 0.975 + fsz);
    CLASSES.forEach(function (cls) {
      var any = false;
      var text = rows.map(function (r) {
        var s = '', has = false;
        r.forEach(function (cell) { if (cell.c === cls && /\S/.test(cell.ch)) { s += cell.ch; has = true; } else s += ' '; });
        if (!has) return '';
        any = true;
        return '​' + s.replace(/\s+$/, '');
      }).join('\n');
      if (!any) return;
      group.push(env.text({ id: 'code-' + cls, name: CLASS_NAMES[cls], text: text, x: codeX, y: codeY, w: textW, font: FONT, weight: 400, size: fsz, min: fsz, lineHeight: lh, color: C.ensure(theme.ink[cls], theme.bg, 4.6) }));
    });
    if (numbers) {
      var nw = Math.ceil((digits + 0.4) * adv * fsz / 0.975 + 2);
      group.push(env.text({ id: 'line-numbers', name: 'Line numbers', text: nums.join('\n'), x: codeX - P.gutter + 0.2 * adv * fsz, y: codeY, w: nw, font: FONT, weight: 400, size: fsz, min: fsz, lineHeight: lh, align: 'right', color: C.ensure(theme.nums, theme.bg, 4.6) }));
      /* Right-aligned numbers: env.text narrows the box to the text; keep it at the gutter edge. */
      var ln = group[group.length - 1];
      ln.x = Math.round(codeX - 1.2 * adv * fsz - ln.w);
    }
    if (group.length) out = out.concat(env.print.group('Code', group, 'code'));
    return { layers: out, top: y, lang: hl.lang };
  }

  /* ---------- In the studio form: paste, drop, and "Hide something" ---------- */
  function ui(F, api) {
    var c = F.c;
    if (!c || !F.node) return null;
    var host = F.node.querySelector('.mk-body');
    var bar = document.createElement('div');
    bar.className = 'mkb-bar';
    bar.innerHTML = '<p class="mkb-tip">Paste a screenshot or code here (Ctrl+V), or drop a file.</p>' +
      '<button type="button" class="btn btn-sm mkb-hide">' + (c.ic ? c.ic('eyeOff') : '') + '<span>Hide something</span></button>';
    host.insertBefore(bar, F.form);
    var hide = bar.querySelector('.mkb-hide');
    hide.title = 'Make the design, then cover or blur part of the screenshot';
    hide.onclick = function () {
      if (F.values.mode === 'code') { if (c.toast) c.toast('Hiding parts works on screenshots. Switch to Screenshot first.'); return; }
      api.make().then(function (pg) {
        if (!pg) return;
        var shot = (pg.layers || []).filter(function (l) { return l.type === 'image'; })[0];
        if (shot && c.scene && c.scene.select) try { c.scene.select([shot.id]); } catch (e) {}
        if (window.LEStudioPanels && window.LEStudioPanels.redact && c.openPanel) c.openPanel('redact');
        else if (c.toast) c.toast('Use Redact on the photo toolbar to hide part of it.');
      });
    };
    function useFile(f) {
      if (!f || !/^image\//.test(f.type || '')) return false;
      c.ingest(f).then(function (meta) {
        if (!ST_alive()) return;
        F.values.shot = meta.id; F.values.mode = 'shot';
        api.refresh();
      }).catch(function (err) { if (c.toast) c.toast((err && err.message) || 'Could not read that image.'); });
      return true;
    }
    function ST_alive() { return document.body.contains(F.node); }
    function onPaste(e) {
      var dt = e.clipboardData;
      if (!dt) return;
      var files = [].slice.call(dt.files || []);
      if (files.length && useFile(files[0])) { e.preventDefault(); return; }
      var t = e.target;
      if (t && (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && t.type !== 'checkbox'))) return;
      var text = dt.getData('text/plain');
      if (text && /\S/.test(text)) {
        e.preventDefault();
        F.values.code = String(text).replace(/\r\n?/g, '\n').split('\n').slice(0, 40).join('\n').slice(0, 2000);
        F.values.mode = 'code';
        api.refresh();
      }
    }
    function onDragOver(e) { if (e.dataTransfer && [].slice.call(e.dataTransfer.types || []).indexOf('Files') >= 0) { e.preventDefault(); F.node.classList.add('mkb-drop'); } }
    function onDragLeave(e) { if (e.target === F.node || !F.node.contains(e.relatedTarget)) F.node.classList.remove('mkb-drop'); }
    function onDrop(e) {
      F.node.classList.remove('mkb-drop');
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) { e.preventDefault(); useFile(f); }
    }
    document.addEventListener('paste', onPaste);
    F.node.addEventListener('dragover', onDragOver);
    F.node.addEventListener('dragleave', onDragLeave);
    F.node.addEventListener('drop', onDrop);
    loadCss('beautify');
    return function () { document.removeEventListener('paste', onPaste); };
  }
  /* The maker's own few form styles, loaded with its form (assets/css/makers-<id>.css). */
  function loadCss(id) {
    if (document.querySelector('link[data-mk-css="' + id + '"]')) return;
    var root = document.documentElement.getAttribute('data-root') || '';
    if (root && root.charAt(root.length - 1) !== '/') root += '/';
    var l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = root + 'assets/css/makers-' + id + '.css'; l.setAttribute('data-mk-css', id);
    document.head.appendChild(l);
  }
})();
