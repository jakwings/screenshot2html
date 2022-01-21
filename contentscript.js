'use strict';

// https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/drawWindow
// https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toDataURL
// https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob
async function DrawWindow$(request) {
  try {
    let canvas = document.createElement('canvas');
    let context = canvas.getContext('2d', {alpha: false});
    let {format, quality, rect: {x, y, width, height}} = request;
    quality = (format === 'image/jpeg' ? quality / 100 : 1);

    canvas.width = Math.trunc(width);
    canvas.height = Math.trunc(height);
    context.drawWindow(window, x, y, width, height, 'rgba(255,255,255,1)');
    return canvas.toDataURL(format, quality);

    //// Security Error: Content at moz-extension://<uuid>/background.html may not
    //// load data from blob:https://example.com/<uuid>
    //return new Promise((resolve, reject) => {
    //  try {
    //    canvas.toBlob(blob => {
    //      resolve(URL.createObjectURL(blob));
    //    }, format, quality);
    //  } catch (err) {
    //    reject(err);
    //  }
    //});
  } catch (err) {
    console.error(err);
    throw err;
  }
}


// https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Content_scripts#communicating_with_background_scripts
browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.type) {
    case 'DrawWindow': return DrawWindow$(request);
  }
  return false;
});
