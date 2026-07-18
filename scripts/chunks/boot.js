function boot() {
  UI.stage = document.getElementById('stage');
  UI.cv = document.getElementById('cv');
  UI.ctx = UI.cv.getContext('2d');
  UI.panel = document.getElementById('panel');
  UI.warning = document.getElementById('warning');
  UI.statMoney = document.getElementById('stat-money');
  UI.statTraffic = document.getElementById('stat-traffic');
  UI.statTime = document.getElementById('stat-time');
  UI.btnTanker = document.getElementById('btn-tanker');
  UI.btnGbr = document.getElementById('btn-gbr');
  UI.btnLight = document.getElementById('btn-light');
  UI.tankerSub = UI.btnTanker.querySelector('.sub');
  UI.gbrSub = UI.btnGbr.querySelector('.sub');
  UI.lightSub = document.getElementById('light-sub');
  UI.screenStart = document.getElementById('screen-start');
  UI.screenEnd = document.getElementById('screen-end');
  UI.endTitle = document.getElementById('end-title');
  UI.endDesc = document.getElementById('end-desc');
  UI.endStats = document.getElementById('end-stats');
  UI.btnNext = document.getElementById('btn-next');
  UI.levelRow = document.getElementById('level-row');
  UI.panelRef = null;

  UI.LW = 420;
  const rect = UI.stage.getBoundingClientRect();
  UI.LH = clamp(Math.round(UI.LW * (rect.height / Math.max(1, rect.width))), 560, 940);
  Road.build(UI.LW, UI.LH);
  Depot.init();
  GBRBase.init();
  resize();
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 150));

  // тап по канвасу: touchstart/touchend (основной ввод) + click для десктопа
  let tStart = null;
  UI.cv.addEventListener('touchstart', e => {
    const t = e.changedTouches[0];
    tStart = { x: t.clientX, y: t.clientY };
  }, { passive: true });
  UI.cv.addEventListener('touchend', e => {
    e.preventDefault();
    const t = e.changedTouches[0];
    if (tStart && Math.hypot(t.clientX - tStart.x, t.clientY - tStart.y) < 12)
      handleTap(t.clientX, t.clientY);
    tStart = null;
  }, { passive: false });
  UI.cv.addEventListener('click', e => handleTap(e.clientX, e.clientY));

  bindTap(UI.panel, e => {
    const b = e.target.closest ? e.target.closest('[data-act]') : null;
    if (b && !b.disabled) handlePanelAction(b.dataset);
  });
  bindTap(UI.btnTanker, () => callTanker());
  bindTap(UI.btnGbr, () => callGBR());
  bindTap(UI.btnLight, () => toggleTrafficLight());
  bindTap(UI.levelRow, e => {
    const b = e.target.closest ? e.target.closest('[data-lvl]') : null;
    if (b && !b.disabled) {
      UI.screenStart.classList.add('hidden');
      newGame('campaign', +b.dataset.lvl);
    }
  });
  bindTap(document.getElementById('btn-endless'), () => {
    UI.screenStart.classList.add('hidden');
    newGame('endless');
  });
  bindTap(document.getElementById('btn-restart'), () => {
    UI.screenEnd.classList.add('hidden');
    newGame(Game.mode, Game.levelIdx);
  });
  bindTap(UI.btnNext, () => {
    UI.screenEnd.classList.add('hidden');
    newGame('campaign', Game.levelIdx + 1);
  });
  bindTap(document.getElementById('btn-menu'), () => showMenu());
  bindTap(document.getElementById('btn-fs'), () => {
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen();
    else if (document.exitFullscreen) document.exitFullscreen();
  });

  renderMenu();
  updateHUD();
  requestAnimationFrame(frame);
}
