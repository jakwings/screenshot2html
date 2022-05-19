'use strict';

function CreateHTML$({title, uri, grid, text, direction}) {
  return new Blob([
`<!DOCTYPE html>
<html dir="${direction}">
  <head>
    <meta charset="utf-8">
    <title>${HtmlEscape$(title)}</title>
    <link rel="canonical" href="${HtmlEscape$(uri)}">
    <style>
* {
  margin: 0;
  padding: 0;
  line-height: 0;
}
:root {
  background: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="rgb(255,255,255)"/><path d="m 5 0 5 5 -5 5 -5 -5 5 -5 z" fill="rgb(230,230,230)"/></svg>');
}
center, #images, #text {
  position: relative;
}
#images {
  white-space: pre !important;
}
#images::after {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}
#text {
  margin-top: ${-text.height || 0}px;
  width: ${text.width || 0}px;
  height: ${text.height || 0}px;
  overflow: hidden;
}
#text * {
  position: absolute;
  white-space: pre !important;
  overflow: visible;
  color: transparent;
}
    </style>
  </head>
  <body>
    <center>
<pre id="images">
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
<pre id="text">
`,
    text.contents || '',
`
</pre>
    </center>
  </body>
</html>
`
  ], {type: 'text/html'});
}


browser.browserAction.onClicked.addListener(async (tab) => {
  // https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Browser_support_for_JavaScript_APIs
  const BROWSER_VERSION_MAJOR = parseInt((await browser.runtime.getBrowserInfo()).version, 10);
  const browserAction = browser.browserAction;
  const badge = ['setTitle', 'setBadgeText', 'setBadgeBackgroundColor'].every(v => {
    return v in browserAction;
  });

  const mutex = new Mutex({lock_time: 1000 * 60 * 5});
  const key = 'browserAction-' + tab.id;

  const date = new Date();
  const nid = date.getTime();
  const jobs = new JobQueue();
  const object_ids = [];
  const object_urls = [];

  const downloads = new Map();
  downloads.promise = new Promise((resolve, reject) => {
    downloads.resolve = resolve;
    downloads.reject = reject;
  });
  const OnDownload$ = (delta) => {
    if (delta.state && downloads.has(delta.id)) {
      if (delta.state.current === 'complete') {
        URL.revokeObjectURL(downloads.get(delta.id).url);
        downloads.delete(delta.id);
        if (downloads.size === 0) {
          downloads.resolve();
        }
      } else if (delta.state.current === 'interrupted') {
        URL.revokeObjectURL(downloads.get(delta.id).url);
        downloads.reject();
      }
    }
  };
  browser.downloads.onChanged.addListener(OnDownload$);

  let restoreScrollPosition = () => Promise.resolve();
  try {
    if (!(await mutex.lock(key, {retry: false}))) {
      return;
    }
    await browserAction.disable(tab.id);

    const config = await Config.get();

    // file extension, file type, mime type
    const format = config.jpeg ? ['jpg', 'jpeg', 'image/jpeg']
                               : ['png', 'png', 'image/png'];
    const quality = config.jpeg ? config.quality : 100;
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
    const info = await executeContentScript(tab, 'scripts/MeasurePage.js');
    const scale = BROWSER_VERSION_MAJOR >= 82 ? info.scale : 1;
    const limits = [32767 / scale, 472907776 / (scale * scale)].map(Math.trunc);

    const {
      view: {width: vw, height: vh},
      page: {width: pw, height: ph},
      scroll: {sx, sy, spx, spy},
      direction: dir,
    } = info;

    if (pw * ph > 4096 * 4096) {
      notify(T$('Notice_Screenshot_Large', tab.title), {id: nid});
    }

    const use_native = (BROWSER_VERSION_MAJOR >= 82
                        || (scale == 1 && CanvasRenderingContext2D.prototype.drawWindow));
    const use_css_croll = !use_native;
    const use_js_scroll = !use_native && !use_css_croll;
    console.info({use_native, use_css_croll, use_js_scroll, BROWSER_VERSION_MAJOR});

    const js_scroll_restore = `window.scrollTo(${sx + spx}, ${sy + spy})`;
    const css_reset = {
      allFrames: true,
      runAt: 'document_start',
      code: `
        :root { min-width: 100vw !important; min-height: 100vh !important; }
        *, *>*, *>*>* { animation-play-state: paused !important; }
      `,
    };
    if (BROWSER_VERSION_MAJOR >= 53) {
      css_reset.cssOrigin = 'user';
    }

    let resetScrollPosition = () => {
      // TODO: stop js and svg animation
      return browser.tabs.insertCSS(tab.id, css_reset).then(() => {
        // reset position of sticky elements
        return browser.tabs.executeScript(tab.id, {
          runAt: 'document_start',
          code: 'window.scrollTo(0, 0)',
        });
      });
    };
    let updateScrollPosition = null;

    restoreScrollPosition = () => {
      restoreScrollPosition = () => Promise.resolve();
      return browser.tabs.removeCSS(tab.id, css_reset).then(() => {
        return browser.tabs.executeScript(tab.id, {
          runAt: 'document_start',
          code: js_scroll_restore,
        });
      });
    };
    if (use_css_croll) {
      let tasks = [() => browser.tabs.removeCSS(tab.id, css_reset)];
      restoreScrollPosition = () => {
        restoreScrollPosition = () => Promise.resolve();
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
        if (false && BROWSER_VERSION_MAJOR >= 82 && scale == window.devicePixelRatio) {
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
    if (!use_native && mw * mh > limits[1]) {
      abort('canvas too large');
    }

    let decoding = new JobQueue();
    let grid = [], text = {};
    {
      if (badge) {
        await browserAction.setTitle({title: T$('Badge_Capturing'), tabId: tab.id});
        await browserAction.setBadgeBackgroundColor({color: 'red', tabId: tab.id});
      }
      let total = Math.ceil(pw / mw) * Math.ceil(ph / mh);
      let count = 0;

      await resetScrollPosition();
      for (let y = 0; y < ph; y += mh) {
        let h = (y + mh <= ph ? mh : ph - y);
        let row = [];
        for (let x = 0; x < pw; x += mw) {
          let w = (x + mw <= pw ? mw : pw - x);
          let _sx = dir.x > 0 ? x : Math.min(-(pw - x) + vw, vw - w);
          let _sy = dir.y > 0 ? y : Math.min(-(ph - y) + vh, vh - h);
          let i = count++;
          if (badge) {
            jobs.push(() => {
              // no waiting since capturing is in serial order; unimportant text
              browserAction.setBadgeText({text: String(total--), tabId: tab.id});
            });
          }
          if (use_native) {
            if (BROWSER_VERSION_MAJOR >= 82) {
              let opts = {
                format: format[1],
                quality: quality,
                rect: {x: _sx, y: _sy, width: w, height: h},
                scale: scale,
              };
              jobs.push(() => browser.tabs.captureTab(tab.id, opts));
            } else {
              // doesn't seem to support high dpi
              let opts = {
                format: format[2],
                quality: quality,
                rect: {x: _sx, y: _sy, width: w, height: h},
              };
              jobs.push(() => executeContentScript(tab, 'scripts/DrawWindow.js', opts));
            }
            jobs.push(url => {
              decoding.push(() => fetch(url).then(res => res.blob()).then(blob => {
                object_urls[i] = URL.createObjectURL(blob);
              }));
            });
          } else {
            let pos = null, img = new Image();
            let args = [x, y, w, h];
            jobs.push(async () => pos = await updateScrollPosition(...args));
            if (BROWSER_VERSION_MAJOR >= 59) {
              jobs.push(() => browser.tabs.captureTab(tab.id, {
                format: format[1],
                quality: 100,
              }));
            } else {
              jobs.push(() => browser.tabs.captureVisibleTab(tab.windowId, {
                format: format[1],
                quality: 100,
              }));
            }
            jobs.push(url => {
              decoding.push(() => {
                img._decoded = img.decode ? {
                  then: (func) => img.decode().then(func),
                } : new Promise((resolve, reject) => {
                  img.onload = function OnLoad$() {
                    return img.complete ? resolve() : setTimeout(OnLoad$, 0);
                  };
                  img.onerror = reject;
                });
                img.src = url;
                return img._decoded.then(() => new Promise(resolve => {
                  let [w, h] = args.slice(2, 4);
                  let canvas = document.createElement('canvas');
                  let ctx = canvas.getContext('2d', {alpha: false});
                  canvas.width = Math.trunc(w * scale);
                  canvas.height = Math.trunc(h * scale);
                  ctx.drawImage(img, pos.x * scale, pos.y * scale, w * scale, h * scale,
                                                 0,             0, w * scale, h * scale);
                  canvas.toBlob(blob => {
                    resolve(object_urls[i] = URL.createObjectURL(blob));
                  }, format[2], quality / 100);
                }));
              });
            });
          }
          row.push({w, h});
        }
        grid.push(row);
      }

      if (config.text) {
        jobs.push(() => {
          if (badge) {
            browserAction.setBadgeText({text: '0', tabId: tab.id});
          }
          return executeContentScript(tab, 'scripts/ExtractText.js', {
            allFrames: false,
          }).then(result => {
            // TODO: all frames; limit iframes to visible area
            text = result;
          });
        });
      }

      await jobs.serial().then(restoreScrollPosition);
    }
    {
      if (badge) {
        await browserAction.setTitle({title: T$('Badge_Saving'), tabId: tab.id});
        await browserAction.setBadgeText({text: '...', tabId: tab.id});
        await browserAction.setBadgeBackgroundColor({color: 'green', tabId: tab.id});
      }
      await decoding.parallel();
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
          jobs.push(() => {
            return browser.downloads.download({
              url: url,
              filename: filepath,
              saveAs: false,
            }).then(id => {
              object_ids.push(id);
              downloads.set(id, {url, filepath});
            });
          });
          grid[row][col].url = filename;
        }
      }
    }
    await jobs.parallel();
    {
      let title = info.title;
      let uri = config.uri ? tab.url : '';
      if (!config.file_uri) {
        // TODO: detect :root>head>title ?
        title = title.replace(/^file:.*/, '');
        uri = uri.replace(/^file:.*/, '');
      }
      let url = URL.createObjectURL(CreateHTML$({
        title, uri, grid, text,
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
        downloads.set(id, {url, filepath});
      }).catch(abort);
      let timer_id = setTimeout(() => {
        downloads.reject(T$('Screenshot_Timeout', filepath));
      }, 1000 * 60 * 5);
      await downloads.promise.then(() => {
        clearTimeout(timer_id);
        notify(T$('Screenshot_Success', filepath), {id: nid});
      }).catch(() => {
        abort(new ExtensionError(T$('Screenshot_Failure', filepath)));
      });
    }
  } catch (err) {
    console.error(err);
    if (err instanceof ExtensionError) {
      notify(String(err), {id: nid});
    } else {
      notify(T$('Error', err), {id: nid});
    }
    object_ids.forEach(id => {
      browser.downloads.cancel(id)
      .then(() => browser.downloads.removeFile(id))
      .catch(ignore);
    });
    object_urls.forEach(url => {
      URL.revokeObjectURL(url);
    });
    restoreScrollPosition().catch(ignore);
  } finally {
    browser.downloads.onChanged.removeListener(OnDownload$);
    object_ids.forEach(id => browser.downloads.erase({id}).catch(ignore));
    if (await mutex.lock(key, {retry: false})) {
      if (badge) {
        await browserAction.setTitle({title: '', tabId: tab.id});
        await browserAction.setBadgeText({text: '', tabId: tab.id});
        try {
          await browserAction.setBadgeBackgroundColor({color: null, tabId: tab.id});
        } catch (err) {
          await browserAction.setBadgeBackgroundColor({color: '', tabId: tab.id});
        }
      }
      setTimeout(async () => {
        await browserAction.enable(tab.id);
        mutex.unlock(key);
      }, Math.max(1000 - (Date.now() - date.getTime()), 0));
    }
  }
});
