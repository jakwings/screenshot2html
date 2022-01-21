'use strict';

function CreateHTML$({title, url, grid, direction}) {
  return new Blob([
`<!DOCTYPE html>
<html dir="${direction}">
  <head>
    <meta charset="utf-8">
    <title>${HtmlEscape$(title)}</title>
    <link rel="canonical" href="${HtmlEscape$(url)}">
    <style>
* {
  margin: 0;
  padding: 0;
  line-height: 0;
}
:root {
  background: url('data:image/svg+xml,%3csvg xmlns="http://www.w3.org/2000/svg" width="10" height="10"%3e%3crect width="10" height="10" fill="rgb(255,255,255)"/%3e%3cpath d="m 5 0 5 5 -5 5 -5 -5 5 -5 z" fill="rgb(230,230,230)"/%3e%3c/svg%3e');
}
:root::after {
  content: "";
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}
    </style>
  </head>
  <body>
    <center>
<pre>
`,
    grid.map(row => {
      let html = row.map(i => {
        return `<img src="${HtmlEscape$(i.url)}" width="${i.w}" height="${i.h}">`;
      });
      if (direction === 'rtl') {
        html.reverse();
      }
      return html.join('');
    }).join('\n'),
`
</pre>
    </center>
  </body>
</html>
`
  ], {type: 'text/html'});
}

// https://www.w3.org/TR/2016/WD-cssom-view-1-20160317/#dom-element-clientheight
// https://www.w3.org/TR/2016/WD-cssom-view-1-20160317/#dom-document-scrollingelement
// https://dom.spec.whatwg.org/#dom-document-compatmode
async function MeasurePage$(tab) {
  return browser.tabs.executeScript(tab.id, {
    runAt: 'document_start',
    code: `{
      const root = document.documentElement;
      const page = document.scrollingElement || root;
      const {scrollWidth: sw, scrollHeight: sh} = root;
      const {clientWidth: cw, clientHeight: ch} = page;
      const {innerWidth: ww, innerHeight: wh} = window;
      const {scrollX: sx, scrollY: sy} = window;
      const [_sx, _sy] = [sx, sy].map(Math.trunc);
      const [spx, spy] = [sx - _sx, sy - _sy];
      const [bw, bh] = [ww - cw, ww - ch];

      ({
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
        page: {width:  sw, height: sh},
        // subpixel-precise decimal, negative when Right2Left or Bottom2Top
        scroll: {sx: _sx, sy: _sy, spx, spy},
        // scrollbar width/height
        scrollbar: {width: bw, height: bh},
        // https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio
        scale: window.devicePixelRatio,
      })
    }`
  }).then(result => {
    return result ? result[0] : Promise.reject(result);
  }).catch(err => {
    console.error(err);
    throw new ExtensionError(T$('Error_Invalid', tab.title, tab.url));
  });
}


const downloads = Object.create(null);

browser.downloads.onChanged.addListener(async (delta) => {
  if (delta.id in downloads && delta.state) {
    if (delta.state.current === 'complete') {
      let info = downloads[delta.id];
      URL.revokeObjectURL(info.url);
      delete downloads[delta.id];
      if (/\.html$/.test(info.filepath)) {
        notify(T$('Download_Success', info.filepath));
      }
    } else if (delta.state.current === 'interrupted') {
      let info = downloads[delta.id];
      URL.revokeObjectURL(info.url);
      delete downloads[delta.id];
      notify(T$('Download_Failure', info.filepath));
    }
  }
});

browser.browserAction.onClicked.addListener(async (tab) => {
  // https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Browser_support_for_JavaScript_APIs
  const BROWSER_VERSION_MAJOR = parseInt((await browser.runtime.getBrowserInfo()).version, 10);
  const badge = ['setTitle', 'setBadgeText', 'setBadgeBackgroundColor'].every(v => {
    return v in browser.browserAction;
  });

  const mutex = new Mutex({lock_time: 1000 * 60 * 5});
  const key = 'browserAction-' + tab.id;

  const date = new Date();
  const jobs = [];
  const object_ids = [];
  const object_urls = [];

  try {
    if (!(await mutex.lock(key, {retry: false}))) {
      return;
    }
    browser.browserAction.disable(tab.id);

    const config = await Config.get();

    // file extension, file type, mime type
    const format = config.jpeg ? ['jpg', 'jpeg', 'image/jpeg']
                               : ['png', 'png', 'image/png'];
    const quality = config.jpeg ? Math.min(Math.max(config.quality, 1), 100) : 100;
    const basename = [
      'Screenshot-',
      String(date.getFullYear()),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
      '-',
      String(date.getHours()).padStart(2, '0'),
      String(date.getMinutes()).padStart(2, '0'),
      String(date.getSeconds()).padStart(2, '0'),
    ].join('');

    // WTF: animation sucks your eyeballs out during multiple screen captures
    const info = await MeasurePage$(tab);
    const scale = BROWSER_VERSION_MAJOR >= 82 ? info.scale : 1;
    const limits = [32767, 472907776].map(v => Math.trunc(v / scale));

    const {
      view: {width: vw, height: vh},
      page: {width: pw, height: ph},
      scroll: {sx, sy, spx, spy},
      direction: dir,
    } = info;

    if (pw * ph > 4096 * 4096) {
      notify(T$('Notice_Screenshot_Large', tab.title));
    }

    const use_native = (BROWSER_VERSION_MAJOR >= 82
                        || (scale == 1 && CanvasRenderingContext2D.prototype.drawWindow));
    const use_css_croll = !use_native;
    const use_js_scroll = !use_native && !use_css_croll;
    const js_scroll_restore = `window.scrollTo(${sx + spx}, ${sy + spy})`;
    console.info({use_native, use_css_croll, use_js_scroll, BROWSER_VERSION_MAJOR});

    let restoreScrollPosition = () => {
      restoreScrollPosition = () => {};
      return browser.tabs.executeScript(tab.id, {
        runAt: 'document_start',
        code: js_scroll_restore,
      });
    };
    let updateScrollPosition = null;

    if (use_css_croll) {
      let tasks = [];
      restoreScrollPosition = () => {
        restoreScrollPosition = () => {};
        return Promise.all(tasks.map(exec => exec())).then(() => {
          return browser.tabs.executeScript(tab.id, {
            runAt: 'document_start',
            code: js_scroll_restore,
          });
        });
      };
      // https://developer.mozilla.org/en-US/docs/Web/CSS/Cascade
      let applyCssScroll = null;
      // XXX: stuttering of background when scrollbar disappear?
      //      setting min-width/height doesn't seem to work
      let style = (await browser.tabs.executeScript(tab.id, {
        runAt: 'document_start',
        code: `{
          let style = window.getComputedStyle(document.documentElement);
          ({
            translate: style.translate,
            transform: style.transform,
            bgx: style.backgroundPositionX,
            bgy: style.backgroundPositionY,
          })
        }`,
      }))[0];
      style.bgx = style.bgx.split(/\s*,\s*/);
      style.bgy = style.bgy.split(/\s*,\s*/);
      if (style.translate != null) {
        let xyz = (style.translate.replace(/^none$/, '') + ' 0px 0px 0px').trim().split(/\s+/);
        applyCssScroll = (x, y) => {
          let bgx = style.bgx.map(v => `calc(${v} - ${x}px)`).join(', ');
          let bgy = style.bgy.map(v => `calc(${v} - ${y}px)`).join(', ');
          let css = {
            runAt: 'document_start',
            code: `
              :root {
                translate: calc(${xyz[0]} - ${x}px) calc(${xyz[1]} - ${y}px)
                           ${xyz[2]} !important;
                transition: none !important;
                animation: none !important;
                background-position-x: ${bgx} !important;
                background-position-y: ${bgy} !important;
              }
            `,
          };
          if (BROWSER_VERSION_MAJOR >= 53) {
            css.cssOrigin = 'user';
          }
          return browser.tabs.insertCSS(tab.id, css).then(() => {
            tasks.push(() => browser.tabs.removeCSS(tab.id, css));
          });
        };
      } else {
        let toCSS = (x, y) => {
          if (/\bmatrix(?:3d)?\b/.test(style.transform)) {
            return style.transform.replace(
              /\b(matrix(?:3d)?)\s*\(([^)]*)\)/,
              (_, func, args) => {
                let xyz = args.split(/\s*,\s*/);
                switch (func) {
                  case 'matrix':
                    xyz[4] = `calc(${xyz[4]} - ${x}px)`;
                    xyz[5] = `calc(${xyz[5]} - ${y}px)`;
                    break;
                  case 'matrix3d':
                    xyz[12] = `calc(${xyz[12]} - ${x}px)`;
                    xyz[13] = `calc(${xyz[13]} - ${y}px)`;
                    break;
                  default: throw new Error('toCSS');
                }
                return `${func}(${xyz.join(', ')})`;
              }
            );
          } else {
            return style.transform.replace(/^none$/, '') + ` translate(-${x}px, -${y}px)`;
          }
        };
        applyCssScroll = (x, y) => {
          let bgx = style.bgx.map(v => `calc(${v} - ${x}px)`).join(', ');
          let bgy = style.bgy.map(v => `calc(${v} - ${y}px)`).join(', ');
          let css = {
            runAt: 'document_start',
            code: `
              :root {
                transform: ${toCSS(x, y)} !important;
                transition: none !important;
                animation: none !important;
                background-position-x: ${bgx} !important;
                background-position-y: ${bgy} !important;
              }
            `,
          };
          if (BROWSER_VERSION_MAJOR >= 53) {
            css.cssOrigin = 'user';
          }
          return browser.tabs.insertCSS(tab.id, css).then(() => {
            tasks.push(() => browser.tabs.removeCSS(tab.id, css));
          });
        };
      }
      updateScrollPosition = async (x, y, w, h) => {
        // _s[xy] is not clamped when exceeding scrollMax[XY]
        let _sx = dir.x > 0 ? x : -(pw - x) + w;
        let _sy = dir.y > 0 ? y : -(ph - y) + h;
        await applyCssScroll(_sx, _sy);
        return {
          x: dir.x > 0 ? 0 : vw - w,
          y: dir.y > 0 ? 0 : vh - h,
        };
      };
    } else if (use_js_scroll) {
      updateScrollPosition = async (x, y, w, h) => {
        // _s[xy] is not clamped when exceeding scrollMax[XY]
        let _sx = dir.x > 0 ? x : -(pw - x) + w;
        let _sy = dir.y > 0 ? y : -(ph - y) + h;
        await browser.tabs.executeScript(tab.id, {
          runAt: 'document_start',
          code: `window.scrollTo(${_sx}, ${_sy})`,
        });
        return {
          x: x <= pw - vw ? 0 : vw - w,
          y: y <= ph - vh ? 0 : vh - h,
        };
      };
    }

    const [mw, mh] = (() => {
      // XXX: browser.tab.captureTab and DrawWindow:
      //      glitches happen on large capture area
      //      happens when scale != window.devicePixelRatio ?
      //      test page: https://en.wikipedia.org/wiki/Firefox
      if (use_native) {
        if (BROWSER_VERSION_MAJOR >= 82 && scale == window.devicePixelRatio) {
          return [pw, ph].map(v => Math.min(v, limits[0]));
        } else {
          return [Math.min(pw, limits[0], 4095), Math.min(ph, limits[0], 16383)];
        }
      } else {
        return [Math.min(vw, limits[0], 4095), Math.min(vh, limits[0], 16383)];
      }
    })();

    // Maximum size is limited!
    // https://developer.mozilla.org/en-US/docs/Web/HTML/Element/canvas#maximum_canvas_size
    if (!use_native && mw * scale * mh * scale > limits[1]) {
      abort('canvas too large');
    }
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', {alpha: false});
    ctx.scale(scale, scale);

    let grid = [];
    {
      // reset position of sticky elements
      await browser.tabs.executeScript(tab.id, {
        runAt: 'document_start',
        code: 'window.scrollTo(0, 0)',
      });

      if (badge) {
        browser.browserAction.setTitle({title: T$('Badge_Capturing'), tabId: tab.id});
        browser.browserAction.setBadgeBackgroundColor({color: 'red', tabId: tab.id});
      }
      let total = Math.ceil(pw / mw) * Math.ceil(ph / mh), count = 0;

      for (let y = 0; y < ph; y += mh) {
        let h = (y + mh <= ph ? mh : ph - y);
        let row = [];
        for (let x = 0; x < pw; x += mw) {
          let w = (x + mw <= pw ? mw : pw - x);
          let _sx = dir.x > 0 ? x : Math.min(-(pw - x) + vw, vw - w);
          let _sy = dir.y > 0 ? y : Math.min(-(ph - y) + vh, vh - h);
          let job = null, i = count++;
          if (badge) {
            browser.browserAction.setBadgeText({text: String(total--), tabId: tab.id});
          }
          if (use_native) {
            if (BROWSER_VERSION_MAJOR >= 82) {
              job = browser.tabs.captureTab(tab.id, {
                format: format[1],
                quality: quality,
                rect: {x: _sx, y: _sy, width: w, height: h},
                scale: scale,
              });
            } else {
              // doesn't seem to support high dpi
              job = browser.tabs.sendMessage(tab.id, {
                type: 'DrawWindow',
                format: format[2],
                quality: quality,
                rect: {x: _sx, y: _sy, width: w, height: h},
              });
            }
            job = job.then(url => fetch(url))
                     .then(res => res.blob())
                     .then(blob => {
                       object_urls[i] = URL.createObjectURL(blob);
                     });
          } else {
            let pos = null, img = document.createElement('img');
            img._decoded = img.decode ? {
              then: (func) => img.decode().then(func),
            } : new Promise((resolve, reject) => {
              img.onload = function OnLoad$() {
                return img.complete ? resolve() : setTimeout(OnLoad$, 0);
              };
              img.onerror = reject;
            });
            pos = await updateScrollPosition(x, y, w, h);
            if (BROWSER_VERSION_MAJOR >= 59) {
              img.src = await browser.tabs.captureTab(tab.id, {
                format: format[1],
                quality: 100,
              });
            } else {
              img.src = await browser.tabs.captureVisibleTab(tab.windowId, {
                format: format[1],
                quality: 100,
              });
            }
            job = img._decoded.then(() => new Promise(resolve => {
              canvas.width = Math.trunc(w * scale);
              canvas.height = Math.trunc(h * scale);
              ctx.drawImage(img, pos.x * scale, pos.y * scale, w * scale, h * scale,
                                             0,             0, w * scale, h * scale);
              canvas.toBlob(blob => {
                resolve(object_urls[i] = URL.createObjectURL(blob));
              }, format[2], quality / 100);
            }));
          }
          jobs.push(job);
          row.push({w, h});
        }
        grid.push(row);
      }
      if (badge) {
        browser.browserAction.setTitle({title: T$('Badge_Saving'), tabId: tab.id});
        browser.browserAction.setBadgeText({text: '...', tabId: tab.id});
        browser.browserAction.setBadgeBackgroundColor({color: 'green', tabId: tab.id});
      }
      restoreScrollPosition();
    }
    await Promise.all(jobs.splice(0));
    {
      let count = 0;
      let len1 = 1 + (Math.log10(grid.length) | 0);
      for (let row of grid.keys()) {
        let len2 = 1 + (Math.log10(grid[row].length) | 0);
        for (let col of grid[row].keys()) {
          let number = [
            String(row + 1).padStart(len1, '0'),
            String(col + 1).padStart(len2, '0'),
          ].join('-');
          let filename = `${number}.${format[0]}`;
          let filepath = `${basename}/${filename}`;
          let url = object_urls[count++];
          jobs.push(
            browser.downloads.download({
              url: url,
              filename: filepath,
              saveAs: false,
            }).then(id => {
              object_ids.push(id);
              downloads[id] = {url, filepath};
            })
          );
          grid[row][col].url = filename;
        }
      }
    }
    await Promise.all(jobs.splice(0));
    {
      let url = URL.createObjectURL(CreateHTML$({
        title: info.title,
        url: config.url ? tab.url : '',
        grid: grid,
        direction: dir.x > 0 ? 'ltr' : 'rtl',
      }));
      object_urls.push(url);
      let filepath = `${basename}/index.html`;
      browser.downloads.download({
        url: url,
        filename: filepath,
        saveAs: false,
      }).then(id => {
        object_ids.push(id);
        downloads[id] = {url, filepath};
      }).catch(abort);
    }
  } catch (err) {
    console.error(err);
    if (err instanceof ExtensionError) {
      notify(String(err));
    } else {
      notify(T$('Error', err));
    }
    restoreScrollPosition();
    object_ids.forEach(id => {
      delete downloads[id];
      browser.downloads.cancel(id);
    });
    object_urls.forEach(url => {
      URL.revokeObjectURL(url);
    });
  } finally {
    if (await mutex.lock(key, {retry: false})) {
      if (badge) {
        browser.browserAction.setTitle({title: '', tabId: tab.id});
        browser.browserAction.setBadgeText({text: '', tabId: tab.id});
        browser.browserAction.setBadgeBackgroundColor({color: '', tabId: tab.id});
      }
      setTimeout(() => {
        browser.browserAction.enable(tab.id);
        mutex.unlock(key);
      }, Math.max(1000 - (Date.now() - date.getTime()), 0));
    }
  }
});
