'use strict';

// https://www.w3.org/TR/2016/WD-cssom-view-1-20160317/#dom-element-clientheight
// https://www.w3.org/TR/2016/WD-cssom-view-1-20160317/#dom-document-scrollingelement
// https://dom.spec.whatwg.org/#dom-document-compatmode
function MeasurePage$() {
  const root = document.documentElement;
  const page = document.scrollingElement || root;
  const {scrollWidth: sw, scrollHeight: sh} = root;
  const {clientWidth: cw, clientHeight: ch} = page;
  const {innerWidth: ww, innerHeight: wh} = window;
  const {scrollX: sx, scrollY: sy} = window;
  const [_sx, _sy] = [sx, sy].map(Math.trunc);
  const [spx, spy] = [sx - _sx, sy - _sy];
  const [bw, bh] = [ww - cw, wh - ch];

  return {
    // tab.title is file:///* when the local html has no title set
    title: document.title,
    // direction of axis X/Y (Left2Right/Top2Bottom = 1; Right2Left/Bottom2Top = -1)
    direction: {
      x: sx < 0 || (window.scrollMaxX <= 0 && sw > cw) ? -1 : 1,
      y: sy < 0 || (window.scrollMaxY <= 0 && sh > ch) ? -1 : 1,
    },
    // view width/height (excluding scrollbar width/height)
    view: {width: cw, height: ch},
    // page width/height
    page: {width: (sw || ww), height: (sh || wh)},
    // subpixel-precise decimal, negative when Right2Left or Bottom2Top
    scroll: {sx: _sx, sy: _sy, spx, spy},
    // scrollbar width/height
    scrollbar: {width: bw, height: bh},
    // https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio
    scale: window.devicePixelRatio,
  };
}


MeasurePage$()
