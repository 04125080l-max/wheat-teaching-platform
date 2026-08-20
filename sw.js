/* 冬小麦智能教学平台 · Service Worker
 * [P2·STEP4.5] 缓存策略修复：
 *  1. install 逐项 fetch + res.ok 校验，单资源失败跳过且不阻塞整体安装（替代 addAll 全有或全无）
 *  2. CACHE bump v4 → v5（可追踪、可回滚，不用随机版本）
 *  3. activate 只清理本项目 wheat-* namespace（不再删除其他站点 cache）
 *  4. 预缓存清单更新：stage1-8.webp（WebP primary）+ hero poster；移除 49.9MB PNG、14.1MB 视频
 *  5. fetch 回填仅缓存成功完整响应（status 200）；206/304 不缓存（保护视频 Range 行为）
 */
const CACHE = 'wheat-v2.0-v6'; /* [P2·STEP4.6修复] v6：.mp4 直通不缓存（serve-dev 对 Range 返回 200 全量，v5 的通用 200 回填曾将播放过的视频写入 cache） */
const PRECACHE = [
  /* 页面 */
  './index-v2.html',
  './index.html',
  './home.html',
  './journey.html',
  './pet-window.html',
  './manifest.webmanifest',
  /* 脚本与样式（已带版本参数的 URL 保留原样） */
  './assets/pet.css?v=20260817l',
  './assets/pet.js?v=20260817l',
  './assets/gsap.min.js',
  './assets/anime.min.js',
  './assets/three.min.js',
  /* 图标与兜底 */
  './assets/wheat-real.png',
  './assets/icon-192.png',
  './assets/icon-512.png',
  /* 阶段图 WebP（STEP 4.2 primary；PNG 49.9MB 作为在线 fallback 不预缓存） */
  './wheat/figures-cutout/stage1.webp',
  './wheat/figures-cutout/stage2.webp',
  './wheat/figures-cutout/stage3.webp',
  './wheat/figures-cutout/stage4.webp',
  './wheat/figures-cutout/stage5.webp',
  './wheat/figures-cutout/stage6.webp',
  './wheat/figures-cutout/stage7.webp',
  './wheat/figures-cutout/stage8.webp',
  /* hero 首帧 poster（STEP 4.3；hero.mp4 桌面按需加载不预缓存） */
  './assets/wheat-hero-poster.webp'
];
self.addEventListener('install', function(e){
  e.waitUntil(
    caches.open(CACHE).then(function(c){
      /* 逐项缓存：单资源失败仅跳过并记 warning，不影响整体 install */
      return Promise.all(PRECACHE.map(function(url){
        return fetch(url).then(function(res){
          if(!res.ok){
            console.warn('[SW] precache skip (HTTP ' + res.status + '): ' + url);
            return null;
          }
          return c.put(url, res);
        }).catch(function(){
          console.warn('[SW] precache skip (network): ' + url);
          return null;
        });
      }));
    }).then(function(){ return self.skipWaiting(); })
  );
});
self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      /* 只清理本项目 wheat-* 旧缓存，保留当前 CACHE；不触碰其他站点 cache */
      return Promise.all(
        keys.filter(function(k){ return k !== CACHE && k.indexOf('wheat-') === 0; })
            .map(function(k){ return caches.delete(k); })
      );
    }).then(function(){ return self.clients.claim(); })
  );
});
self.addEventListener('fetch', function(e){
  if(e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if(url.origin !== location.origin) return;
  /* HTML 导航：网络优先（保证更新），离线回退缓存；仅回填成功响应 */
  if(e.request.mode === 'navigate' || url.pathname.endsWith('.html')){
    e.respondWith(
      fetch(e.request).then(function(res){
        if(res && res.ok){
          const copy = res.clone();
          caches.open(CACHE).then(function(c){ c.put(e.request, copy); });
        }
        return res;
      }).catch(function(){ return caches.match(e.request); })
    );
    return;
  }
  /* 视频直通：不缓存不匹配（按需网络加载，与 STEP 4.3 策略一致；即使服务器返回 200 全量也不入 cache） */
  if(url.pathname.endsWith('.mp4')){
    e.respondWith(fetch(e.request));
    return;
  }
  /* 静态资源：缓存优先，未命中网络并回填；仅缓存 200 完整响应（206/304 不缓存，保护视频 Range） */
  e.respondWith(
    caches.match(e.request).then(function(hit){
      if(hit) return hit;
      return fetch(e.request).then(function(res){
        if(res && res.status === 200){
          const copy = res.clone();
          caches.open(CACHE).then(function(c){ c.put(e.request, copy); });
        }
        return res;
      });
    })
  );
});
