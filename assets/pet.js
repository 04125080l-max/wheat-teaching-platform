/* ============================================================
   田园物语 · 伴学麦苗宝宝（Q 版桌宠）核心逻辑
   - 纯原生 JS，零依赖（不依赖游戏内部实现，只依赖桥接口）
   - 主模式：嵌入游戏页面，事件 + 轮询双通道驱动
   - 独立窗口模式（?pet=1）：经 BroadcastChannel 接收状态快照
   - 状态机参考 dsh-dafeiyu：优先级仲裁 + 签名去重 + 脉冲回落
   ============================================================ */
(function () {
  'use strict';

  /* ============================================================
     右键菜单：全局委托（捕获阶段，绑定在脚本最前部）
     - 捕获阶段 + 顶层绑定：不受后续任何代码错误/页面拦截影响
     - 页面任意位置右键都可呼出桌宠菜单（输入框/面板内保留浏览器菜单）
     - 菜单渲染函数由 buildDom 之后挂载到 window.__wheatPetMenu
     ============================================================ */
  document.addEventListener('contextmenu', function (e) {
    try {
      var t = e.target;
      if (t && t.closest) {
        if (t.closest('#petPanel')) return;
        if (t.closest('input, textarea, select')) return;
      }
      e.preventDefault();
      if (typeof window.__wheatPetMenu === 'function') {
        window.__wheatPetMenu(e.clientX, e.clientY);
      }
    } catch (err) {}
  }, true);

  /* ---------------- 配置 ---------------- */
  var CFG_KEY = 'wheatPetCfg';
  var DEFAULT_CFG = { x: null, y: null, scale: 1, reduced: false, activity: 'normal', mode: 'fixed' };
  var cfg = loadCfg();
  function loadCfg() {
    try {
      var s = localStorage.getItem(CFG_KEY);
      if (s) { var p = JSON.parse(s); if (p && typeof p === 'object') return Object.assign({}, DEFAULT_CFG, p); }
    } catch (e) {}
    return Object.assign({}, DEFAULT_CFG);
  }
  function saveCfg() { try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (e) {} }

  var REDUCED = cfg.reduced || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  var IS_STANDALONE = /[?&]pet=1/.test(location.search);
  var STAGE_NAMES = ['播种期', '出苗期', '分蘖期', '越冬期', '返青期', '拔节期', '抽穗开花期', '成熟期'];

  /* ---------------- 桥（游戏页面注入；独立窗口无桥） ---------------- */
  var bridge = window.__wheatBridge || null;
  function getGameState() { try { return bridge ? bridge.getState() : null; } catch (e) { return null; } }

  /* ---------------- 广播（同源窗口桥） ---------------- */
  var bc = null;
  try { if (typeof BroadcastChannel !== 'undefined') bc = new BroadcastChannel('wheat-pet'); } catch (e) {}
  function broadcast(msg) { try { if (bc) bc.postMessage(msg); } catch (e) {} }

  /* ============================================================
     精灵 SVG 渲染：8 阶段形态 × 情绪表情
     ============================================================ */
  function face(mood) {
    var f = '';
    if (mood === 'happy') {
      f += '<path class="pe-eye-open" d="M46 60 Q50 54 54 60" stroke="#2c3a2c" stroke-width="2.6" fill="none" stroke-linecap="round"/>';
      f += '<path class="pe-eye-open" d="M64 60 Q68 54 72 60" stroke="#2c3a2c" stroke-width="2.6" fill="none" stroke-linecap="round"/>';
      f += '<path class="pe-mouth" d="M56 72 Q60 79 66 72" stroke="#2c3a2c" stroke-width="2.4" fill="none" stroke-linecap="round"/>';
    } else if (mood === 'proud') {
      f += '<path class="pe-eye-open" d="M46 60 Q50 53 54 60 Q50 57 46 60Z" fill="#2c3a2c"/>';
      f += '<path class="pe-eye-open" d="M64 60 Q68 53 72 60 Q68 57 64 60Z" fill="#2c3a2c"/>';
      f += '<path class="pe-mouth" d="M54 71 Q60 78 68 71 L68 71 Q60 82 54 71Z" fill="#2c3a2c"/>';
    } else if (mood === 'worried') {
      f += '<path class="pe-brow" d="M45 53 L55 56" stroke="#2c3a2c" stroke-width="2.4" stroke-linecap="round"/>';
      f += '<path class="pe-brow" d="M73 53 L63 56" stroke="#2c3a2c" stroke-width="2.4" stroke-linecap="round"/>';
      f += '<ellipse class="pe-eye-open" cx="50" cy="61" rx="2.6" ry="3.4" fill="#2c3a2c"/>';
      f += '<ellipse class="pe-eye-open" cx="68" cy="61" rx="2.6" ry="3.4" fill="#2c3a2c"/>';
      f += '<path class="pe-mouth" d="M56 72 Q60 68 66 72" stroke="#2c3a2c" stroke-width="2.4" fill="none" stroke-linecap="round"/>';
    } else if (mood === 'sick') {
      f += '<path class="pe-eye-open" d="M46 61 Q50 57 54 61" stroke="#2c3a2c" stroke-width="2.6" fill="none" stroke-linecap="round"/>';
      f += '<path class="pe-eye-open" d="M64 61 Q68 57 72 61" stroke="#2c3a2c" stroke-width="2.6" fill="none" stroke-linecap="round"/>';
      f += '<path class="pe-mouth" d="M56 72 Q60 76 66 72" stroke="#2c3a2c" stroke-width="2.4" fill="none" stroke-linecap="round"/>';
      f += '<text x="84" y="46" font-size="13">💫</text>';
    } else if (mood === 'sleepy') {
      f += '<path class="pe-eye-closed" d="M44 61 Q50 57 56 61" stroke="#2c3a2c" stroke-width="2.6" fill="none" stroke-linecap="round"/>';
      f += '<path class="pe-eye-closed" d="M62 61 Q68 57 74 61" stroke="#2c3a2c" stroke-width="2.6" fill="none" stroke-linecap="round"/>';
      f += '<path class="pe-mouth" d="M57 73 Q61 70 65 73" stroke="#2c3a2c" stroke-width="2.2" fill="none" stroke-linecap="round"/>';
    } else { /* normal */
      f += '<ellipse class="pe-eye-open" cx="50" cy="60" rx="3" ry="4" fill="#2c3a2c"/>';
      f += '<ellipse class="pe-eye-open" cx="68" cy="60" rx="3" ry="4" fill="#2c3a2c"/>';
      f += '<path class="pe-mouth" d="M56 71 Q60 75 64 71" stroke="#2c3a2c" stroke-width="2.2" fill="none" stroke-linecap="round"/>';
    }
    f += '<ellipse cx="41" cy="67" rx="4.5" ry="3" fill="#ffb3c1" opacity=".65"/>';
    f += '<ellipse cx="77" cy="67" rx="4.5" ry="3" fill="#ffb3c1" opacity=".65"/>';
    return f;
  }

  /* 根据阶段与情绪生成整只麦苗宝宝 */
  function petSvg(stage, mood) {
    var sick = mood === 'sick';
    var g = sick ? '#c9b83c' : '#7bc96f';        // 叶色（病态发黄）
    var gDeep = sick ? '#b3a135' : '#4d9e4d';     // 深叶
    var stem = sick ? '#9aa23c' : '#5aa854';
    var gold = mood === 'proud' || stage >= 7 ? '#e8b34b' : '#e3c566';
    var head = '#8fd183';
    var s = '';

    /* 土堆（前两阶段明显，后面收窄） */
    s += '<ellipse cx="70" cy="152" rx="' + (stage <= 1 ? 30 : 22) + '" ry="' + (stage <= 1 ? 11 : 7) + '" fill="#a9744f" opacity=".9"/>';
    s += '<ellipse cx="70" cy="150" rx="' + (stage <= 1 ? 22 : 15) + '" ry="6" fill="#c08a5e" opacity=".85"/>';

    if (stage === 0) {
      /* 播种期：一颗种子冒小芽 */
      s += '<ellipse cx="70" cy="143" rx="12" ry="9" fill="#a9744f"/>';
      s += '<path d="M70 136 Q70 126 70 120" stroke="#7bc96f" stroke-width="3.4" fill="none" stroke-linecap="round"/>';
      s += '<path d="M70 126 Q62 120 58 112" stroke="#7bc96f" stroke-width="3" fill="none" stroke-linecap="round"/>';
      s += '<path d="M70 128 Q78 122 82 114" stroke="#7bc96f" stroke-width="3" fill="none" stroke-linecap="round"/>';
      s += '<circle cx="70" cy="60" r="26" fill="#8fd183"/>';
      s += '<ellipse cx="70" cy="60" rx="26" ry="26" fill="url(#pgradS)" opacity=".0"/>';
      s += face(mood);
    } else if (stage === 1) {
      /* 出苗期：两片嫩叶的小苗 */
      s += '<path d="M70 138 Q70 120 70 104" stroke="' + stem + '" stroke-width="5" fill="none" stroke-linecap="round"/>';
      s += '<path d="M66 118 Q46 108 40 92 Q56 100 68 110Z" fill="' + g + '"/>';
      s += '<path d="M74 112 Q92 100 100 84 Q86 94 72 106Z" fill="' + gDeep + '"/>';
      s += '<circle cx="70" cy="58" r="25" fill="#8fd183"/>';
      s += face(mood);
    } else {
      /* 分蘖期起：有茎有叶，形态随阶段长大 */
      var h = [0, 0, 4, 2, 6, 12, 10, 8][stage] || 4;   /* 头在茎上的位置偏移 */
      var headCy = 108 - [0, 0, 10, 2, 26, 48, 52, 48][stage] || 60;
      var headR = [0, 0, 24, 26, 26, 27, 26, 27][stage] || 25;
      var leafN = [0, 0, 4, 3, 4, 5, 5, 5][stage] || 4;
      var stemH = [0, 0, 52, 40, 84, 110, 118, 114][stage] || 60;

      s += '<path d="M70 146 Q70 ' + (146 - stemH * 0.35) + ' 70 ' + (146 - stemH) + '" stroke="' + stem + '" stroke-width="' + (stage >= 5 ? 8 : 6) + '" fill="none" stroke-linecap="round"/>';

      /* 叶子：越后期越高、越舒展 */
      var leaves = [
        [0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0],
        [-20, 14, -34, 6, 22, 16, 34, 8, 0, 0, 0, 0],
        [-16, 12, -28, 2, 20, 12, 30, 3, 0, 0, 0, 0],
        [-24, 30, -44, 14, 26, 30, 46, 15, -18, 56, -32, 46, 20, 58, 34, 48, 0, 0, 0, 0],
        [-26, 44, -50, 26, 28, 44, 52, 27, -20, 76, -38, 62, 22, 78, 40, 64, -16, 100, -28, 90, 18, 102, 30, 92],
        [-26, 44, -50, 26, 28, 44, 52, 27, -20, 76, -38, 62, 22, 78, 40, 64, -16, 100, -28, 90, 18, 102, 30, 92],
        [-26, 44, -50, 26, 28, 44, 52, 27, -20, 76, -38, 62, 22, 78, 40, 64, -16, 100, -28, 90, 18, 102, 30, 92]
      ];
      var lv = leaves[stage] || [];
      var stemTop = 146 - stemH;
      for (var i = 0; i < lv.length && i < leafN * 4; i += 4) {
        var bx = 70 + lv[i], by = stemTop + lv[i + 1];
        var ex = 70 + lv[i + 2], ey = stemTop + lv[i + 3];
        var midx = (bx + ex) / 2 - 6, midy = (by + ey) / 2 - 4;
        s += '<path d="M' + bx + ' ' + by + ' Q' + midx + ' ' + midy + ' ' + ex + ' ' + ey + '" stroke="' + (i % 8 === 0 ? gDeep : g) + '" stroke-width="7" fill="none" stroke-linecap="round"/>';
      }

      /* 头（麦穗宝宝） */
      var hx = 70, hy = headCy + h;
      if (stage >= 6) {
        /* 抽穗开花/成熟：麦穗头 */
        var grain = stage >= 7;
        var c1 = grain ? '#e8b34b' : '#e3c566';
        var c2 = grain ? '#d99a2b' : '#cfb23f';
        s += '<rect x="' + (hx - 9) + '" y="' + (hy - headR) + '" width="18" height="' + (headR * 2) + '" rx="9" fill="' + c1 + '"/>';
        for (var gi = 0; gi < 4; gi++) {
          var gy = hy - headR + 8 + gi * 10;
          s += '<ellipse cx="' + (hx - 6) + '" cy="' + gy + '" rx="4.5" ry="3.4" fill="' + c2 + '"/>';
          s += '<ellipse cx="' + (hx + 6) + '" cy="' + (gy + 4) + '" rx="4.5" ry="3.4" fill="' + c2 + '"/>';
        }
        s += '<path d="M' + (hx - 4) + ' ' + (hy - headR - 6) + ' L' + (hx - 8) + ' ' + (hy - headR - 16) + '" stroke="' + c1 + '" stroke-width="2.4" stroke-linecap="round"/>';
        s += '<path d="M' + (hx + 4) + ' ' + (hy - headR - 6) + ' L' + (hx + 8) + ' ' + (hy - headR - 16) + '" stroke="' + c1 + '" stroke-width="2.4" stroke-linecap="round"/>';
        s += '<path d="M' + hx + ' ' + (hy - headR - 8) + ' L' + hx + ' ' + (hy - headR - 18) + '" stroke="' + c1 + '" stroke-width="2.4" stroke-linecap="round"/>';
        if (stage === 6) {
          s += '<circle cx="' + (hx - 11) + '" cy="' + (hy - headR + 6) + '" r="3" fill="#ffb3c1"/>';
          s += '<circle cx="' + (hx + 11) + '" cy="' + (hy - headR + 10) + '" r="3" fill="#ffd54f"/>';
        }
      } else {
        s += '<circle cx="' + hx + '" cy="' + hy + '" r="' + headR + '" fill="' + head + '"/>';
        /* 头顶小苗/麦芒 */
        s += '<path d="M' + hx + ' ' + (hy - headR + 2) + ' L' + hx + ' ' + (hy - headR - 12) + '" stroke="' + gDeep + '" stroke-width="3.2" stroke-linecap="round"/>';
        s += '<path d="M' + (hx - 5) + ' ' + (hy - headR + 5) + ' Q' + (hx - 12) + ' ' + (hy - headR - 2) + ' ' + (hx - 14) + ' ' + (hy - headR - 8) + '" stroke="' + g + '" stroke-width="2.6" fill="none" stroke-linecap="round"/>';
        s += '<path d="M' + (hx + 5) + ' ' + (hy - headR + 5) + ' Q' + (hx + 12) + ' ' + (hy - headR - 2) + ' ' + (hx + 14) + ' ' + (hy - headR - 8) + '" stroke="' + g + '" stroke-width="2.6" fill="none" stroke-linecap="round"/>';
      }

      /* 越冬期雪帽 */
      if (stage === 3) {
        s += '<path d="M' + (hx - headR + 2) + ' ' + (hy - 10) + ' Q' + hx + ' ' + (hy - headR - 14) + ' ' + (hx + headR - 2) + ' ' + (hy - 10) + ' L' + (hx + headR + 6) + ' ' + (hy - 6) + ' L' + (hx - headR - 6) + ' ' + (hy - 6) + 'Z" fill="#eef4fb" stroke="#d6e2f0" stroke-width="1.6"/>';
        s += '<circle cx="' + (hx - 6) + '" cy="' + (hy - headR + 6) + '" r="4.4" fill="#ffffff"/>';
        s += '<circle cx="' + (hx + 7) + '" cy="' + (hy - headR + 10) + '" r="3.4" fill="#ffffff"/>';
      }
      s += face(mood);
    }
    return s;
  }

  /* ============================================================
     DOM 构建
     ============================================================ */
  function buildDom() {
    var root = document.createElement('div');
    root.id = 'wheatPet';
    root.innerHTML =
      '<div class="pet-stage pet-breathe"><svg viewBox="0 0 140 170" xmlns="http://www.w3.org/2000/svg" id="wheatPetSvg"></svg></div>' +
      '<div class="pet-shadow"></div>' +
      '<div class="pet-bubble"><div class="pb-row"><span class="pb-icon"></span><span class="pb-title"></span></div><div class="pb-detail"></div></div>' +
      '<div class="pet-grabbing"></div>' +
      '<div class="pet-zzz">💤</div>' +
      '<div class="pet-menu" style="display:none"></div>';
    document.body.appendChild(root);
    return {
      root: root,
      stage: root.querySelector('.pet-stage'),
      svg: root.querySelector('#wheatPetSvg'),
      bubble: root.querySelector('.pet-bubble'),
      bubbleIcon: root.querySelector('.pb-icon'),
      bubbleTitle: root.querySelector('.pb-title'),
      bubbleDetail: root.querySelector('.pb-detail'),
      zzz: root.querySelector('.pet-zzz'),
      menu: root.querySelector('.pet-menu')
    };
  }

  var dom = buildDom();
  var stageEl = dom.stage;
  var currentStage = 0;
  var currentMood = 'normal';
  var lastFace = '';

  function renderPet(stage, mood, animate) {
    currentStage = stage;
    currentMood = mood;
    var body = petSvg(stage, mood);
    if (body !== lastFace) {
      dom.svg.innerHTML = body;
      lastFace = body;
    }
    if (animate) {
      var a = petSvg(stage, 'sleepy');
      void a;
      stageEl.classList.remove('pet-bounce', 'pet-wiggle', 'pet-droop', 'pet-celebrate', 'pet-tap', 'pet-shake');
      void stageEl.offsetWidth;
      stageEl.classList.add('pet-bounce');
    }
    dom.zzz.classList.toggle('show', mood === 'sleepy' && stage === 3);
    dom.root.title = (STAGE_NAMES[stage] || '') + ' · ' + moodLabel(mood);
  }

  function moodLabel(m) {
    return { happy: '开心', normal: '自在', worried: '担忧', sick: '不舒服', sleepy: '打盹', proud: '自豪' }[m] || '自在';
  }

  /* 阶段 → 形态 + 情绪 */
  function stageMoodFrom(st) {
    var m = 'normal';
    if (st.stage === 3) m = 'sleepy';
    else if (st.currentPest || st.currentPest2) m = 'sick';
    else if ((st.health || 100) < 45) m = 'sick';
    else if ((st.health || 100) < 75) m = 'worried';
    else if ((st.water || 50) < 25 || (st.fert || 50) < 25) m = 'worried';
    else if ((st.health || 100) >= 95 && st.water >= 60) m = 'happy';
    return m;
  }

  function setScale(v) {
    cfg.scale = Math.min(1.4, Math.max(0.6, v));
    dom.root.style.transformOrigin = 'bottom right';
    applyPetTransform();
    saveCfg();
  }

  /* ============================================================
     气泡：优先级 + 去重 + 超时
     ============================================================ */
  var BUBBLE_PRIORITY = { error: 60, waiting: 55, success: 45, working: 35, thinking: 25, idle: 5 };
  var bubbleState = { prio: -1, title: '', detail: '', state: 'idle', ttl: 0, until: 0, persistent: false, since: 0 };
  var bubbleTimer = null;

  var BUBBLE_ICONS = { success: '✓', error: '!', waiting: '…', thinking: '·', working: '▶', idle: '·' };

  function showBubble(title, detail, state, ttlMs, persistent) {
    var prio = BUBBLE_PRIORITY[state] || 0;
    var now = Date.now();
    /* 同等优先级：新消息覆盖旧消息；但 persistent 警报（error/waiting 级）在 30s 内保持霸屏 */
    if (prio < bubbleState.prio && now < bubbleState.until) return;
    if (prio === bubbleState.prio && bubbleState.persistent && !persistent && bubbleState.prio > 10 && now - bubbleState.since < 30000) return;
    bubbleState = {
      prio: prio, title: title, detail: detail, state: state,
      ttl: ttlMs || 0, until: now + (ttlMs || 0), persistent: !!persistent, since: now
    };
    dom.bubbleIcon.textContent = BUBBLE_ICONS[state] || '·';
    dom.bubbleTitle.textContent = title;
    dom.bubbleDetail.textContent = detail || '';
    dom.bubble.className = 'pet-bubble show pb-' + state;
    if (bubbleTimer) clearTimeout(bubbleTimer);
    if (persistent || !ttlMs) return;
    bubbleTimer = setTimeout(function () {
      dom.bubble.classList.remove('show');
      bubbleState.prio = -1;
    }, ttlMs);
  }

  function clearBubble() {
    if (bubbleTimer) clearTimeout(bubbleTimer);
    dom.bubble.classList.remove('show');
    bubbleState.prio = -1;
  }

  /* ============================================================
     动作动画
     ============================================================ */
  function playAction(cls) {
    if (REDUCED) return;
    ['pet-bounce', 'pet-wiggle', 'pet-droop', 'pet-celebrate', 'pet-tap', 'pet-shake'].forEach(function (c) {
      stageEl.classList.remove(c);
    });
    void stageEl.offsetWidth;
    stageEl.classList.add(cls);
  }

  function spawnParticles() {
    if (REDUCED) return;
    var chars = ['🎉', '⭐', '✨', '💚', '🌾'];
    for (var i = 0; i < 6; i++) {
      var p = document.createElement('span');
      p.className = 'pet-particle';
      p.textContent = chars[i % chars.length];
      p.style.left = (30 + Math.random() * 90) + 'px';
      p.style.animationDelay = (Math.random() * 0.18) + 's';
      dom.root.appendChild(p);
      (function (el) { setTimeout(function () { el.remove(); }, 1400); })(p);
    }
  }

  /* ============================================================
     状态处理：事件 + 轮询 → 表现
     ============================================================ */
  function refreshFromState(st) {
    if (!st) return;
    var mood = stageMoodFrom(st);
    if (mood !== currentMood || st.stage !== currentStage) {
      renderPet(st.stage, mood, false);
    }
    /* 持续警报（不打扰：只在小变化时更新详情） */
    var issues = [];
    if (st.currentPest || st.currentPest2) {
      var names = [st.currentPest, st.currentPest2].filter(Boolean).map(function (p) { return p.name; });
      issues.push('感染' + names.join('、'));
    }
    if (st.flooded) issues.push('根部积水');
    if (st.water < 25) issues.push('严重缺水');
    if (st.fert < 25) issues.push('严重缺肥');
    if (st.health <= 0) issues.push('小麦枯萎');
    if (issues.length) {
      showBubble('需要你的帮助', issues.join(' · '), 'error', 0, true);
    } else if (bubbleState.persistent && bubbleState.state === 'error') {
      clearBubble();
    }
  }

  /* 事件处理（来自游戏页面的桥） */
  function handleEvent(name, d) {
    d = d || {};
    switch (name) {
      case 'action': {
        var acts = {
          water: { t: '💧 浇水灌溉', s: '土壤湿度回升啦', st: 'working', a: 'pet-wiggle' },
          fert: { t: '🧪 施肥完成', s: '养分补充到位~', st: 'working', a: 'pet-wiggle' },
          pest: { t: '💊 打药治理', s: '病虫害得到控制', st: 'working', a: 'pet-shake' },
          light: { t: '💡 补光开启', s: '光合作用加足马力', st: 'working', a: 'pet-wiggle' },
          vent: { t: '🌬️ 通风换气', s: '根部氧气充足啦', st: 'working', a: 'pet-wiggle' }
        };
        var a = acts[d.type] || { t: '农事操作', s: '完成！', st: 'working', a: 'pet-wiggle' };
        showBubble(a.t, a.s, a.st, 2600);
        playAction(a.a);
        break;
      }
      case 'stageup':
        renderPet(d.stage, 'proud', false);
        showBubble('🌟 晋级 ' + (STAGE_NAMES[d.stage] || ''), '进入新的生长阶段，继续加油！', 'success', 3200);
        playAction('pet-celebrate');
        spawnParticles();
        break;
      case 'delay':
        showBubble('⚠️ 发育延迟', (d.reasons || []).join('、'), 'error', 3400);
        playAction('pet-droop');
        break;
      case 'pest':
        showBubble('🚨 ' + d.name + ' 来袭', '快打开病害图鉴学习防治，及时打药！', 'error', 3600);
        playAction('pet-shake');
        break;
      case 'flood':
        showBubble('🌊 根部积水', '根系缺氧！快通风控水', 'error', 3600);
        playAction('pet-droop');
        break;
      case 'quiz':
        if (d.ok) {
          showBubble('✅ 答对啦！', '掌握度 +1，太棒了~', 'success', 2400);
          playAction('pet-wiggle');
        } else {
          showBubble('❌ 答错了', '已加入复习队列，过几天再来巩固', 'waiting', 3000);
          playAction('pet-droop');
        }
        break;
      case 'teach':
        showBubble('📢 农艺师提示', d.msg || '', 'thinking', 3600);
        playAction('pet-tap');
        break;
      case 'harvest':
        renderPet(7, 'proud', false);
        showBubble('🌾 收获啦！', '一年的辛苦有了回报，金灿灿的麦穗~', 'success', 4000);
        playAction('pet-celebrate');
        spawnParticles();
        break;
      case 'gameover':
        showBubble('😢 小麦倒下了', '调整策略，重新开始吧', 'error', 4000);
        playAction('pet-droop');
        break;
      case 'reset':
        renderPet(0, 'normal', false);
        showBubble('🌱 重新播种', '新一轮种植开始啦', 'idle', 2200);
        break;
      default:
        break;
    }
    broadcast({ type: 'event', name: name, detail: d });
  }

  /* 轮询签名（兜底：回退/读档/自动演示等未拦截路径） */
  var lastSig = '';
  var lastPollTs = 0;
  function bucket(v) { return v < 25 ? 'L' : (v < 50 ? 'M' : (v < 80 ? 'H' : 'F')); }
  function poll() {
    if (IS_STANDALONE) return;
    var st = getGameState();
    if (!st) return;
    var sig = [st.stage, st.day, bucket(st.water), bucket(st.fert), bucket(st.health),
      (st.currentPest ? st.currentPest.name : ''), (st.currentPest2 ? st.currentPest2.name : ''),
      st.flooded ? 1 : 0, (st.reviewQueue || []).length].join('|');
    var now = Date.now();
    /* 状态变化立即广播；否则每 3s 心跳一次，让后开的独立窗口能拿到快照 */
    if (sig !== lastSig || now - lastPollTs > 3000) {
      lastSig = sig;
      lastPollTs = now;
      refreshFromState(st);
      broadcastSnapshot(st);
    }
  }

  var lastSnap = '';
  function broadcastSnapshot(st) {
    var snap = {
      type: 'snapshot',
      stage: st.stage,
      stageName: STAGE_NAMES[st.stage] || '',
      day: st.day,
      mood: currentMood,
      water: st.water, fert: st.fert, health: st.health,
      pest: (st.currentPest || st.currentPest2 || null) ? ((st.currentPest || st.currentPest2).name) : null,
      bubble: bubbleState.persistent ? { title: bubbleState.title, detail: bubbleState.detail, state: bubbleState.state } : null
    };
    var s = JSON.stringify(snap);
    if (s !== lastSnap) {
      lastSnap = s;
      broadcast(snap);
    }
  }

  /* ============================================================
     聊天面板（左键点击桌宠打开；小麦对话 + 智能农艺师集成于此）
     ============================================================ */
  var panel = null;          /* DOM 元素 */
  var panelPersona = 'wheat'; /* wheat | agent */
  var panelVisible = false;

  var PERSONA_META = {
    wheat: { icon: '🌾', label: '小麦麦', ph: '问问小麦的状态，或出题考考我…', hello: '我是小麦麦！我有 AI 大脑啦：能读懂自己的状态、引用农业知识库回答，还会出题考你。', chips: ['你感觉怎么样？', '你渴吗？', '你生病了吗？', '出题考考我', '你怕什么病？'] },
    agent: { icon: '🤖', label: '农艺师小田', ph: '向智能农艺师提问（实时感知你的小麦状态）…', hello: '我是农艺师小田！我能实时看到你的小麦状态、引用知识库回答，还会出题考你。', chips: ['我现在该做什么？', '我感染的病怎么防治？', '出题考考我', '复盘一下我的管理'] }
  };

  function buildPanel() {
    var el = document.createElement('div');
    el.id = 'petPanel';
    el.className = 'pet-panel';
    el.innerHTML =
      '<div class="pp-head">' +
        '<span class="pp-title">🐾 桌宠聊天</span>' +
        '<span class="pp-persona">' +
          '<button class="pp-btn active" data-p="wheat">🌾 小麦</button>' +
          '<button class="pp-btn" data-p="agent">🤖 农艺师</button>' +
        '</span>' +
        '<span class="pp-tools">' +
          '<button class="pp-btn" id="ppKeyBtn" title="API Key 设置">⚙️</button>' +
          '<button class="pp-btn" id="ppClose" title="关闭">✕</button>' +
        '</span>' +
      '</div>' +
      '<div class="pp-key" id="ppKeyBar" style="display:none">' +
        '<input type="password" id="ppKeyInput" placeholder="DeepSeek API Key (sk-...)" />' +
        '<button class="send-btn" id="ppKeySave">保存</button>' +
        '<button class="pp-btn" id="ppKeyClear">清除</button>' +
      '</div>' +
      '<div class="chat-messages pp-msgs" id="ppMsgs"></div>' +
      '<div class="quick-chips pp-chips" id="ppChips"></div>' +
      '<div class="chat-input-row pp-input">' +
        '<input type="text" id="ppInput" placeholder="" />' +
        '<button class="send-btn" id="ppSend">发送</button>' +
      '</div>';
    document.body.appendChild(el);
    var head = el.querySelector('.pp-head');
    /* 面板拖拽（标题栏） */
    var pDrag = { on: false, sx: 0, sy: 0, ox: 0, oy: 0 };
    head.addEventListener('pointerdown', function (e) {
      if (e.target.closest('.pp-btn')) return;
      pDrag = { on: true, sx: e.clientX, sy: e.clientY, ox: el.offsetLeft, oy: el.offsetTop };
      try { head.setPointerCapture(e.pointerId); } catch (err) {}
    });
    head.addEventListener('pointermove', function (e) {
      if (!pDrag.on) return;
      el.style.left = (pDrag.ox + e.clientX - pDrag.sx) + 'px';
      el.style.top = (pDrag.oy + e.clientY - pDrag.sy) + 'px';
      el.style.right = 'auto';
    });
    head.addEventListener('pointerup', function () {
      if (!pDrag.on) return;
      pDrag.on = false;
      cfg.panelX = el.offsetLeft;
      cfg.panelY = el.offsetTop;
      saveCfg();
    });
    /* 身份切换 */
    el.querySelectorAll('.pp-persona .pp-btn').forEach(function (b) {
      b.addEventListener('click', function () { setPanelPersona(b.getAttribute('data-p')); });
    });
    /* 关闭 / Key 区 */
    el.querySelector('#ppClose').addEventListener('click', closePanel);
    el.querySelector('#ppKeyBtn').addEventListener('click', function () {
      var bar = el.querySelector('#ppKeyBar');
      bar.style.display = (bar.style.display === 'none' ? 'flex' : 'none');
      if (bar.style.display !== 'none') el.querySelector('#ppKeyInput').value = '';
    });
    el.querySelector('#ppKeySave').addEventListener('click', function () {
      var v = el.querySelector('#ppKeyInput').value;
      if (bridge && bridge.saveKey) {
        var ok = bridge.saveKey(v);
        showBubble(ok ? '✅ Key 已保存' : '请输入 API Key', '仅保存在本机浏览器', ok ? 'success' : 'waiting', 2200);
        if (ok) { el.querySelector('#ppKeyBar').style.display = 'none'; panelHint('✅ 已启用 AI 大脑，现在发送消息试试！'); }
      }
    });
    el.querySelector('#ppKeyClear').addEventListener('click', function () {
      if (bridge && bridge.clearKey) bridge.clearKey();
      showBubble('已清除 Key', '小麦将回退到固定问答', 'idle', 2200);
      el.querySelector('#ppKeyInput').value = '';
    });
    /* 发送 */
    function panelSend() {
      var input = el.querySelector('#ppInput');
      var text = input.value.trim();
      if (!text || !bridge || !bridge.chatSend) return;
      input.value = '';
      panelMsg(panelPersona, text, true, null, null);
      bridge.chatSend(text, panelPersona, {
        onThinking: function () { panelThinking(true); },
        onReply: function (t, s, ec) { panelThinking(false); panelMsg(panelPersona, t, false, ec, s); },
        onHint: function (msg) {
          panelThinking(false);
          panelHint(msg);
          if (/Key|密钥|API/.test(msg)) el.querySelector('#ppKeyBar').style.display = 'flex';
        }
      });
    }
    el.querySelector('#ppSend').addEventListener('click', panelSend);
    el.querySelector('#ppInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') panelSend(); });
    /* 快捷 chips（含 AI 专家入口） */
    function renderChips() {
      var box = el.querySelector('#ppChips');
      box.innerHTML = '';
      PERSONA_META[panelPersona].chips.forEach(function (t) {
        var b = document.createElement('button');
        b.className = 'quick-chip';
        b.textContent = t;
        b.addEventListener('click', function () {
          if (t === '问AI专家') { try { window.onAskProfessional('请给我当前阶段的管理建议'); } catch (e) {} return; }
          var input = el.querySelector('#ppInput');
          input.value = t;
          panelSend();
        });
        box.appendChild(b);
      });
      if (panelPersona === 'wheat') {
        var e2 = document.createElement('button');
        e2.className = 'quick-chip';
        e2.textContent = '🤖 问AI专家';
        e2.addEventListener('click', function () { try { window.onAskProfessional('请给我当前阶段的管理建议'); } catch (e) {} });
        box.appendChild(e2);
      }
    }
    el.__renderChips = renderChips;
    renderChips();
    return el;
  }

  function panelMsg(persona, text, isUser, ec, sources) {
    if (!panel) return;
    var box = panel.querySelector('#ppMsgs');
    var d = document.createElement('div');
    if (isUser) {
      d.className = 'msg msg-user';
      d.innerText = text;
    } else if (persona === 'agent') {
      d.className = 'msg msg-ai';
      d.innerText = '🤖 ' + text;
      if (sources && sources.length) d.innerHTML += '<div class="msg-sources">📚 依据：' + sources.map(function (s) { return '<b>' + s + '</b>'; }).join('、') + '</div>';
    } else {
      d.className = 'msg msg-wheat ' + (ec || 'normal');
      d.innerText = '🌾 ' + text;
      if (sources && sources.length) d.innerHTML += '<div class="msg-sources">📚 依据：' + sources.map(function (s) { return '<b>' + s + '</b>'; }).join('、') + '</div>';
    }
    box.appendChild(d);
    box.scrollTop = box.scrollHeight;
  }
  function panelHint(msg) {
    if (!panel) return;
    var box = panel.querySelector('#ppMsgs');
    var d = document.createElement('div');
    d.className = 'pp-hint';
    d.innerText = msg;
    box.appendChild(d);
    box.scrollTop = box.scrollHeight;
  }
  var thinkingEl = null;
  function panelThinking(show) {
    if (!panel) return;
    var box = panel.querySelector('#ppMsgs');
    if (show && !thinkingEl) {
      thinkingEl = document.createElement('div');
      thinkingEl.className = 'agent-thinking';
      thinkingEl.innerHTML = '<span class="spin"></span>' + (panelPersona === 'agent' ? '🤖 小田正在思考…' : '🌾 小麦正在想…');
      box.appendChild(thinkingEl);
      box.scrollTop = box.scrollHeight;
    } else if (!show && thinkingEl) {
      thinkingEl.remove();
      thinkingEl = null;
    }
  }
  function setPanelPersona(p) {
    if (p !== 'agent' && p !== 'wheat') return;
    panelPersona = p;
    if (!panel) return;
    panel.querySelectorAll('.pp-persona .pp-btn').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-p') === p);
    });
    panel.querySelector('#ppInput').placeholder = PERSONA_META[p].ph;
    panelHint('已切换到 ' + PERSONA_META[p].icon + ' ' + PERSONA_META[p].label + '（共享同一段对话记忆）');
    panel.__renderChips();
  }
  function openPanel(persona, prefill) {
    if (!panel) panel = buildPanel();
    closeSettings();
    if (persona) setPanelPersona(persona);
    applyPanelPosition();
    panel.style.display = 'flex';
    panelVisible = true;
    var input = panel.querySelector('#ppInput');
    if (prefill) input.value = prefill;
    input.focus();
    if (panel.querySelectorAll('#ppMsgs .msg').length === 0) {
      panelMsg(panelPersona, PERSONA_META[panelPersona].hello, false, 'happy', null);
      if (!bridge || !bridge.hasKey || !bridge.hasKey()) {
        panelHint('💡 未配置 API Key：小麦可用固定问答，农艺师需要 Key。点右上角 ⚙️ 填写（仅存本机）。');
      }
    }
  }
  function closePanel() {
    if (!panel) return;
    panel.style.display = 'none';
    panelVisible = false;
  }
  function togglePanel() {
    if (panelVisible) closePanel(); else openPanel();
  }
  function applyPanelPosition() {
    if (!panel) return;
    var vw = window.innerWidth, vh = window.innerHeight;
    if (typeof cfg.panelX === 'number' && typeof cfg.panelY === 'number') {
      panel.style.left = Math.min(Math.max(0, cfg.panelX), vw - 318) + 'px';
      panel.style.top = Math.min(Math.max(0, cfg.panelY), vh - 430) + 'px';
      panel.style.right = 'auto';
    } else {
      var r = dom.root.getBoundingClientRect();
      var left = r.left - 320;
      if (left < 8) left = r.right + 14;
      left = Math.min(Math.max(8, left), vw - 318);
      var top = Math.min(Math.max(8, r.top - 24), vh - 430);
      panel.style.left = left + 'px';
      panel.style.top = top + 'px';
      panel.style.right = 'auto';
    }
  }

  /* 挂载到桥：外部可打开面板（含预填文本） */
  if (bridge) {
    bridge.chatOpen = function (persona, prefill) {
      openPanel(persona, prefill);
    };
  }

  /* 主动教学消息：桌宠气泡 + 面板内追加 */
  window.addEventListener('wheat:auto-msg', function (e) {
    var d = e.detail || {};
    if (d.text) {
      showBubble('📢 ' + d.text.slice(0, 24), d.text.length > 24 ? d.text : '', 'thinking', 3600);
      if (panelVisible) panelMsg('wheat', d.text, false, d.ec || 'normal', null);
    }
  });

  /* ============================================================
     移动模式：固定（手动拖拽）/ 点击跟随（点击哪里，桌宠跳到哪里并停住）
     ============================================================ */
  var petMode = cfg.mode === 'follow' ? 'follow' : 'fixed';
  var followTarget = null;
  var followArrived = false;   /* 到达目标后完全停摆，避免边缘抖动导致一直跳动 */
  var followRaf = null;        /* rAF 句柄（帧级驱动） */
  var followBaseX = 0, followBaseY = 0;  /* 基准布局位置（点击时缓存一次） */
  var followDX = 0, followDY = 0;        /* transform 平移增量（合成器动画） */
  var followW = 0, followH = 0;          /* 容器尺寸缓存（帧循环内零布局读取） */
  var followLastTs = 0;                  /* 上一帧时间戳（deltaTime 驱动） */

  /* 统一设置容器 transform：平移 + 缩放（scale 由 setScale 管理） */
  function applyPetTransform() {
    dom.root.style.transform = 'translate(' + followDX + 'px, ' + followDY + 'px) scale(' + (cfg.scale || 1) + ')';
  }
  /* 将平移增量落回布局坐标（left/top），transform 只保留缩放 */
  function settleFollowPosition() {
    if (!followTarget && !followDX && !followDY) return;
    /* 落定瞬间禁用 transform 过渡，避免 translate 清零时视觉闪回 */
    dom.root.style.transition = 'none';
    dom.root.style.left = (followBaseX + followDX) + 'px';
    dom.root.style.top = (followBaseY + followDY) + 'px';
    dom.root.style.right = 'auto';
    dom.root.style.bottom = 'auto';
    followDX = 0;
    followDY = 0;
    applyPetTransform();
    void dom.root.offsetWidth;
    dom.root.style.transition = '';
  }

  function setPetMode(m) {
    petMode = (m === 'follow') ? 'follow' : 'fixed';
    cfg.mode = petMode;
    saveCfg();
    if (petMode === 'fixed') {
      stopFollow();
      /* 清除跟随移动留下的 inline 定位，回到保存位置/默认位置 */
      dom.root.style.left = '';
      dom.root.style.top = '';
      dom.root.style.right = '';
      dom.root.style.bottom = '';
      applyPosition();
      showBubble('📌 固定模式', '拖拽我移动，点我聊天', 'idle', 2000);
    } else {
      startFollow();
      showBubble('🐾 点击跟随', '点击页面任意位置，我就蹦蹦跳跳跳过去', 'success', 2400);
    }
  }

  function clampTarget(t) {
    var vw = window.innerWidth, vh = window.innerHeight;
    return {
      x: Math.min(Math.max(6, t.x), vw - 176),
      y: Math.min(Math.max(6, t.y), vh - 218)
    };
  }

  function onDocClick(e) {
    if (petMode !== 'follow') return;
    if (e.target && e.target.closest && e.target.closest('#wheatPet, #petPanel')) return;
    /* 点击驱动：跳到点击位置并停住 */
    followTarget = clampTarget({ x: e.clientX, y: e.clientY });
    followArrived = false;
    /* 基准位置与尺寸：只读一次 DOM（帧循环内零布局读取，避免每帧同步布局卡顿） */
    followBaseX = dom.root.offsetLeft + followDX;
    followBaseY = dom.root.offsetTop + followDY;
    followW = dom.root.offsetWidth;
    followH = dom.root.offsetHeight;
    followDX = 0;
    followDY = 0;
    applyPetTransform();
    hopNow();
    followLastTs = 0;
    if (!followRaf) followRaf = requestAnimationFrame(followTick);
  }

  function hopNow() {
    if (REDUCED) return;
    /* 只加类：pet-hop 为无限循环动画（覆盖呼吸），到达目标时移除即停。
       不强制 reflow 重播，避免主线程同步布局卡顿 */
    stageEl.classList.add('pet-hop');
  }

  function followTick(ts) {
    followRaf = null;
    if (petMode !== 'follow' || !followTarget || followArrived) return;
    /* 基于真实经过时间移动：帧率高时平滑小步，帧率低（主线程被 3D
       渲染占用）时每帧走更多，到达总时间恒定，不会"一卡一卡"拖很久 */
    var dt = Math.min(0.5, followLastTs ? (ts - followLastTs) / 1000 : 1 / 60);
    followLastTs = ts;
    /* 视觉位置 = 缓存基准 + transform 平移（帧循环零布局读取） */
    var cx = followBaseX + followDX + followW / 2;
    var cy = followBaseY + followDY + followH / 2;
    var dx = followTarget.x - cx, dy = followTarget.y - cy;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 8) {
      /* 到达：平移落回布局坐标，完全停摆 */
      followArrived = true;
      settleFollowPosition();
      stageEl.classList.remove('pet-hop');
      return;
    }
    /* 柔和匀速：约 280px/s × 实际时间；step 受 dist 上限约束，
       末帧精确到位，天然无震荡 */
    var step = Math.min(280 * dt, dist);
    followDX += (dx / dist) * step;
    followDY += (dy / dist) * step;
    applyPetTransform();
    followRaf = requestAnimationFrame(followTick);
  }

  function startFollow() {
    if (followRaf) return;
    document.addEventListener('click', onDocClick, true);
    followBaseX = dom.root.offsetLeft;
    followBaseY = dom.root.offsetTop;
    followW = dom.root.offsetWidth;
    followH = dom.root.offsetHeight;
    followRaf = requestAnimationFrame(followTick);
  }

  function stopFollow() {
    if (followRaf) { cancelAnimationFrame(followRaf); followRaf = null; }
    document.removeEventListener('click', onDocClick, true);
    followTarget = null;
    followArrived = false;
    settleFollowPosition();
    stageEl.classList.remove('pet-hop');
  }

  /* ============================================================
     设置面板（齿轮按钮打开）：大小 / 活跃程度 / 减少动态 / 移动模式
     ============================================================ */
  var settingsEl = null;

  function setReduced(v) {
    cfg.reduced = !!v;
    saveCfg();
    REDUCED = cfg.reduced || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (REDUCED) {
      stageEl.classList.remove('pet-breathe', 'pet-hop', 'pet-bounce', 'pet-wiggle', 'pet-droop', 'pet-celebrate', 'pet-tap', 'pet-shake');
      dom.zzz.classList.remove('show');
      if (blinkTimer) clearTimeout(blinkTimer);
      if (microTimer) clearTimeout(microTimer);
    } else {
      stageEl.classList.add('pet-breathe');
      scheduleBlink();
      scheduleMicro();
    }
  }

  function buildSettings() {
    var el = document.createElement('div');
    el.id = 'petSettings';
    el.innerHTML =
      '<div class="ps-head"><span class="ps-title">⚙️ 桌宠设置</span><button class="pp-btn" id="psClose">✕</button></div>' +
      '<div class="ps-body">' +
        '<div class="ps-row"><span><div class="ps-label">角色大小</div><div class="ps-hint">调整精灵整体大小</div></span><span class="ps-group" id="psScale"></span></div>' +
        '<div class="ps-row"><span><div class="ps-label">活跃程度</div><div class="ps-hint">空闲时的微动作频率</div></span><span class="ps-group" id="psActivity"></span></div>' +
        '<div class="ps-row"><span><div class="ps-label">减少动态</div><div class="ps-hint">关闭走动与循环动画</div></span><button class="ps-toggle" id="psReduced"></button></div>' +
        '<div class="ps-row"><span><div class="ps-label">移动模式</div><div class="ps-hint">固定可拖拽；点击跟随则点击哪里跳到哪里</div></span><span class="ps-group" id="psMode"></span></div>' +
        '<div class="ps-row"><button class="ps-btn" id="psHide">👋 本次隐藏</button><button class="ps-btn" id="psResetPos">📍 恢复默认位置</button></div>' +
      '</div>';
    document.body.appendChild(el);
    el.querySelector('#psClose').addEventListener('click', closeSettings);

    /* 角色大小 */
    var scaleBox = el.querySelector('#psScale');
    [['小', 0.8], ['标准', 1], ['大', 1.25]].forEach(function (it) {
      var b = document.createElement('button');
      b.className = 'ps-opt';
      b.textContent = it[0];
      b.addEventListener('click', function () {
        setScale(it[1]);
        syncSettingsUI();
        showBubble('角色大小', '已设为「' + it[0] + '」', 'idle', 1500);
      });
      scaleBox.appendChild(b);
    });

    /* 活跃程度 */
    var actBox = el.querySelector('#psActivity');
    [['安静', 'quiet'], ['标准', 'normal'], ['活泼', 'lively']].forEach(function (it) {
      var b = document.createElement('button');
      b.className = 'ps-opt';
      b.textContent = it[0];
      b.addEventListener('click', function () {
        cfg.activity = it[1];
        saveCfg();
        syncSettingsUI();
        if (microTimer) clearTimeout(microTimer);
        scheduleMicro();
        showBubble('活跃程度', '已设为「' + it[0] + '」', 'idle', 1500);
      });
      actBox.appendChild(b);
    });

    /* 减少动态 */
    el.querySelector('#psReduced').addEventListener('click', function () {
      setReduced(!cfg.reduced);
      syncSettingsUI();
    });

    /* 移动模式 */
    var modeBox = el.querySelector('#psMode');
    [['📌 固定', 'fixed'], ['🐾 点击跳', 'follow']].forEach(function (it) {
      var b = document.createElement('button');
      b.className = 'ps-opt';
      b.textContent = it[0];
      b.addEventListener('click', function () {
        setPetMode(it[1]);
        syncSettingsUI();
      });
      modeBox.appendChild(b);
    });

    /* 本次隐藏 / 恢复默认位置 */
    el.querySelector('#psHide').addEventListener('click', function () {
      closeSettings();
      dom.root.style.display = 'none';
      showRestoreDot(true);
    });
    el.querySelector('#psResetPos').addEventListener('click', function () {
      cfg.x = null; cfg.y = null;
      saveCfg();
      applyPosition();
      showBubble('已恢复默认位置', '回到屏幕右下角', 'idle', 1500);
    });

    /* 面板拖拽（标题栏） */
    var head = el.querySelector('.ps-head');
    var pDrag = { on: false, sx: 0, sy: 0, ox: 0, oy: 0 };
    head.addEventListener('pointerdown', function (e) {
      if (e.target.closest('#psClose')) return;
      pDrag = { on: true, sx: e.clientX, sy: e.clientY, ox: el.offsetLeft, oy: el.offsetTop };
      try { head.setPointerCapture(e.pointerId); } catch (err) {}
    });
    head.addEventListener('pointermove', function (e) {
      if (!pDrag.on) return;
      el.style.left = (pDrag.ox + e.clientX - pDrag.sx) + 'px';
      el.style.top = (pDrag.oy + e.clientY - pDrag.sy) + 'px';
    });
    head.addEventListener('pointerup', function () {
      if (!pDrag.on) return;
      pDrag.on = false;
      cfg.settingsX = el.offsetLeft;
      cfg.settingsY = el.offsetTop;
      saveCfg();
    });
    return el;
  }

  function applySettingsPosition() {
    if (!settingsEl) return;
    var vw = window.innerWidth, vh = window.innerHeight;
    if (typeof cfg.settingsX === 'number' && typeof cfg.settingsY === 'number') {
      settingsEl.style.left = Math.min(Math.max(0, cfg.settingsX), vw - 260) + 'px';
      settingsEl.style.top = Math.min(Math.max(0, cfg.settingsY), vh - 320) + 'px';
      return;
    }
    var r = dom.root.getBoundingClientRect();
    var left = r.right - 260;
    if (left < 8) left = r.left + 14;
    settingsEl.style.left = Math.min(Math.max(8, left), vw - 260) + 'px';
    settingsEl.style.top = Math.min(Math.max(8, r.top - 24), vh - 320) + 'px';
  }

  function syncSettingsUI() {
    if (!settingsEl) return;
    /* 大小 */
    settingsEl.querySelectorAll('#psScale .ps-opt').forEach(function (b, i) {
      var v = [0.8, 1, 1.25][i];
      b.classList.toggle('active', Math.abs(cfg.scale - v) < 0.05);
    });
    /* 活跃程度 */
    settingsEl.querySelectorAll('#psActivity .ps-opt').forEach(function (b, i) {
      var v = ['quiet', 'normal', 'lively'][i];
      b.classList.toggle('active', cfg.activity === v);
    });
    /* 减少动态 */
    settingsEl.querySelector('#psReduced').classList.toggle('on', cfg.reduced === true);
    /* 移动模式 */
    settingsEl.querySelectorAll('#psMode .ps-opt').forEach(function (b, i) {
      var v = ['fixed', 'follow'][i];
      b.classList.toggle('active', petMode === v);
    });
  }

  function openSettings() {
    if (!settingsEl) settingsEl = buildSettings();
    applySettingsPosition();
    settingsEl.style.display = 'flex';
    syncSettingsUI();
    if (panelVisible) closePanel();
  }
  function closeSettings() { if (settingsEl) settingsEl.style.display = 'none'; }
  function toggleSettings() {
    if (settingsEl && settingsEl.style.display === 'flex') closeSettings();
    else openSettings();
  }

  /* 顶部导航栏设置按钮：打开设置面板 */
  var settingsBtn = document.getElementById('petSettingsBtn') || null;
  if (settingsBtn) {
    settingsBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      closeMenu();
      toggleSettings();
      settingsBtn.classList.remove('rotate');
      void settingsBtn.offsetWidth;
      settingsBtn.classList.add('rotate');
    });
  }

  /* ============================================================
     交互：拖拽 / 点击（开面板） / 双击互动 / 右键菜单
     ============================================================ */
  var drag = { on: false, sx: 0, sy: 0, ox: 0, oy: 0, moved: false };

  function applyPosition() {
    if (cfg.x !== null && cfg.y !== null) {
      var vw = window.innerWidth, vh = window.innerHeight;
      dom.root.style.left = Math.min(Math.max(0, cfg.x), vw - 60) + 'px';
      dom.root.style.top = Math.min(Math.max(0, cfg.y), vh - 60) + 'px';
      dom.root.style.right = 'auto';
      dom.root.style.bottom = 'auto';
    } else {
      dom.root.style.left = 'auto';
      dom.root.style.right = '18px';
      dom.root.style.top = 'auto';
      dom.root.style.bottom = '24px';
    }
  }

  dom.root.addEventListener('pointerdown', function (e) {
    if (e.button !== 0) return;
    drag = { on: petMode === 'fixed', sx: e.clientX, sy: e.clientY, ox: dom.root.offsetLeft, oy: dom.root.offsetTop, moved: false };
    if (drag.on) {
      try { dom.root.setPointerCapture(e.pointerId); } catch (err) {}
    }
  });
  dom.root.addEventListener('pointermove', function (e) {
    if (!drag.on) return;
    var dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 6) drag.moved = true;
    if (!drag.moved) return;
    dom.root.classList.add('dragging');
    dom.root.style.left = (drag.ox + dx) + 'px';
    dom.root.style.top = (drag.oy + dy) + 'px';
    dom.root.style.right = 'auto';
    dom.root.style.bottom = 'auto';
  });
  dom.root.addEventListener('pointerup', function (e) {
    if (!drag) return;
    drag.on = false;
    dom.root.classList.remove('dragging');
    if (drag.moved) {
      cfg.x = dom.root.offsetLeft;
      cfg.y = dom.root.offsetTop;
      saveCfg();
    } else {
      /* 单击：打开聊天面板（集成小麦对话 + 智能农艺师） */
      if (IS_STANDALONE) {
        showBubble('聊天在主页面', '回到「田园物语」页面，点击我就能聊天啦', 'idle', 2600);
        playAction('pet-tap');
      } else {
        togglePanel();
      }
    }
  });
  dom.root.addEventListener('dblclick', function () {
    playAction('pet-celebrate');
    showBubble('✨ 最喜欢主人啦', '答对题、治住虫，都是你的功劳~', 'success', 2200);
  });

  /* 右键菜单 */
  function closeMenu() { dom.menu.style.display = 'none'; }
  function openMenu(x, y) {
    var menu = dom.menu;
    var items = [];
    var sizes = [['小', 0.8], ['标准', 1], ['大', 1.25]];
    sizes.forEach(function (it) {
      items.push({
        label: it[0], check: Math.abs(cfg.scale - it[1]) < 0.05,
        run: function () { setScale(it[1]); }
      });
    });
    items.push({ sep: true });
    items.push({
      label: '减少动态', check: cfg.reduced,
      run: function () { cfg.reduced = !cfg.reduced; saveCfg(); }
    });
    items.push({ sep: true });
    items.push({ title: '移动模式' });
    items.push({ label: '📌 固定位置', mode: true, check: petMode === 'fixed', run: function () { setPetMode('fixed'); } });
    items.push({ label: '🐾 跟随鼠标', mode: true, check: petMode === 'follow', run: function () { setPetMode('follow'); } });
    items.push({ sep: true });
    items.push({
      label: '🪟 弹出独立窗口',
      run: function () {
        try { window.open('pet-window.html?pet=1', 'wheatPetWin', 'width=300,height=400'); } catch (e) {}
      }
    });
    items.push({
      label: '👋 本次隐藏',
      run: function () { dom.root.style.display = 'none'; showRestoreDot(true); }
    });
    var html = '<div class="pm-title">麦苗宝宝</div>' + items.map(function (it) {
      if (it.sep) return '<div class="pm-sep"></div>';
      if (it.title) return '<div class="pm-title">' + it.title + '</div>';
      return '<div class="pm-item' + (it.check ? ' pm-check' : '') + '">' + it.label + '</div>';
    }).join('');
    menu.innerHTML = html;
    menu.style.display = 'block';
    var rect = dom.root.getBoundingClientRect();
    var mw = 150, mh = menu.offsetHeight || 170;
    menu.style.left = Math.min(x, window.innerWidth - mw - 6) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - mh - 6) + 'px';
    menu.querySelectorAll('.pm-item').forEach(function (el, i) {
      var real = items.filter(function (it) { return !!it.label; })[i];
      el.addEventListener('click', function () { closeMenu(); if (real) real.run(); });
    });
    var menuOpenedAt = Date.now();
    var onDoc = function (e) {
      /* 防护：忽略右键按钮；菜单打开后 250ms 内的点击不关闭（防"闪一下消失"） */
      if (e.button === 2) return;
      if (Date.now() - menuOpenedAt < 250) return;
      if (!menu.contains(e.target)) { closeMenu(); document.removeEventListener('pointerdown', onDoc); }
    };
    document.addEventListener('pointerdown', onDoc);
  }
  /* 右键菜单：由脚本顶部的全局委托（捕获阶段）调用 __wheatPetMenu */
  window.__wheatPetMenu = openMenu;

  /* 隐藏后的小圆点恢复按钮 */
  function showRestoreDot(show) {
    var dot = document.getElementById('wheatPetRestore');
    if (!dot && show) {
      dot = document.createElement('button');
      dot.id = 'wheatPetRestore';
      dot.textContent = '🌱';
      Object.assign(dot.style, {
        position: 'fixed', right: '14px', bottom: '14px', zIndex: '2147483002',
        width: '34px', height: '34px', borderRadius: '50%', cursor: 'pointer',
        border: '1px solid #d8dde3', background: 'rgba(255,255,255,.92)',
        fontSize: '16px', boxShadow: '0 3px 10px rgba(17,24,39,.18)'
      });
      dot.addEventListener('click', function () {
        dot.remove();
        dom.root.style.display = '';
      });
      document.body.appendChild(dot);
    } else if (dot && !show) {
      dot.remove();
    }
  }

  /* ============================================================
     微动作：眨眼 / 观察 / 打盹（活动度控制）
     ============================================================ */
  var blinkTimer = null;
  function scheduleBlink() {
    if (REDUCED || currentMood === 'sleepy') return;
    var lo = cfg.activity === 'quiet' ? 9000 : (cfg.activity === 'lively' ? 2400 : 5200);
    var hi = cfg.activity === 'quiet' ? 16000 : (cfg.activity === 'lively' ? 4600 : 9000);
    blinkTimer = setTimeout(function () {
      stageEl.classList.add('blink');
      setTimeout(function () { stageEl.classList.remove('blink'); }, 160);
      scheduleBlink();
    }, lo + Math.random() * (hi - lo));
  }

  var microTimer = null;
  function scheduleMicro() {
    if (REDUCED || IS_STANDALONE) return;
    var lo = cfg.activity === 'quiet' ? 26000 : (cfg.activity === 'lively' ? 9000 : 15000);
    var hi = cfg.activity === 'quiet' ? 42000 : (cfg.activity === 'lively' ? 15000 : 26000);
    microTimer = setTimeout(function () {
      if (currentMood === 'sleepy') {
        dom.zzz.classList.add('show');
        setTimeout(function () { dom.zzz.classList.remove('show'); }, 2600);
      } else {
        playAction(Math.random() < 0.5 ? 'pet-wiggle' : 'pet-tap');
      }
      scheduleMicro();
    }, lo + Math.random() * (hi - lo));
  }

  /* ============================================================
     独立窗口模式：接收广播
     ============================================================ */
  function renderStandalone(snap) {
    if (!snap) return;
    renderPet(snap.stage || 0, snap.mood || 'normal', false);
    if (snap.bubble) {
      showBubble(snap.bubble.title, snap.bubble.detail, snap.bubble.state, 0, true);
    } else if (bubbleState.persistent) {
      clearBubble();
    }
  }

  if (IS_STANDALONE) {
    if (bc) {
      bc.onmessage = function (ev) {
        var m = ev.data || {};
        if (m.type === 'snapshot') renderStandalone(m);
        else if (m.type === 'event') handleEvent(m.name, m.detail || {});
      };
    }
    renderPet(0, 'normal', false);
    showBubble('等待游戏连接…', '打开田园物语即可同步状态', 'idle', 0, true);
    if (petMode === 'follow') startFollow();
  } else {
    /* ============================================================
       主模式：初始化 + 订阅游戏事件 + 轮询
       ============================================================ */
    var evNames = ['action', 'stageup', 'delay', 'pest', 'quiz', 'teach', 'harvest', 'gameover', 'reset'];
    evNames.forEach(function (n) {
      window.addEventListener('wheat:' + n, function (e) { handleEvent(n, e.detail || {}); });
    });
    setScale(cfg.scale);
    applyPosition();
    var st0 = getGameState();
    if (st0) {
      var m0 = stageMoodFrom(st0);
      renderPet(st0.stage, m0, false);
      if (st0.stage === 3) showBubble('❄️ 冬眠中', '越冬期好好休息，别打扰我~', 'idle', 0, true);
      broadcastSnapshot(st0);
    } else {
      renderPet(0, 'normal', false);
      showBubble('🌱 伴学麦苗上线', '开始种植，我会陪着你学习', 'idle', 2600);
    }
    scheduleBlink();
    scheduleMicro();
    if (petMode === 'follow') startFollow();
    setInterval(poll, 600);
    /* 适配窗口大小变化时纠正越界位置 */
    window.addEventListener('resize', applyPosition);
  }

  /* 眨眼样式钩子（CSS 里定义） */
  var style = document.createElement('style');
  style.textContent = '#wheatPet .pet-stage .pe-eye-closed{display:none}#wheatPet .pet-stage.blink .pe-eye-open{display:none}#wheatPet .pet-stage.blink .pe-eye-closed{display:block}';
  document.head.appendChild(style);
})();
