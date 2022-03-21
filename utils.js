'use strict';

///* Internationalization */////////////////////////////////////////////

function T$(id, ...args) {
  return browser.i18n.getMessage(id, args);
}


///* Notification */////////////////////////////////////////////////////

class ExtensionError extends Error {
  toString() {
    return this.message;
  }
}

function abort(err) {
  if (err instanceof Error) {
    throw err;
  } else if (err instanceof ErrorEvent) {
    throw err.error || new Error(err.message);
  } else {
    throw new Error(err);
  }
}

function ignore() {
  return;
}

function notify(message = '', {title = T$('Extension_Name'), id = ''} = {}) {
  return browser.notifications.create(String(id), {
    type: 'basic',
    title: title,
    message: String(message),
  });
}


///* DOM Manipulation */////////////////////////////////////////////////

function $(selector) {
  return document.querySelector(selector);
}

function $$(selector) {
  return Array.from(document.querySelectorAll(selector));
}

function $$$(name, attrs, text) {
  let elm = document.createElement(node_name);
  for (let name in attrs) {
    elm.setAttribute(name, attrs[name]);
  }
  if (text != null) {
    elm.textContent = text;
  }
  return elm;
}

function HtmlEscape$(str) {
  return str.replace(/["'<>&]/g, (c) => {
    switch (c) {
      case '"': return '&quot;';
      case "'": return '&apos;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      default: return `&#${c.charCodeAt(0)};`;
    }
  });
}


///* Miscellaneous *////////////////////////////////////////////////////

class JobQueue {
  constructor() {
    this.queue = [];
  }
  push(func) {
    this.queue.push(func);
  }
  parallel() {
    return Promise.all(this.queue.splice(0).map(exec => exec()));
  }
  async serial() {
    let result = [];
    while (this.queue.length > 0) {
      result = this.queue.shift().apply(null, result);
      if (result instanceof Promise) {
        await result.then(function () {
          result = Array.from(arguments);
        });
      } else {
        result = [result];
      }
    }
    return result;
  }
}

// only works for timers and promises in the same page
class Mutex {
  // timeout in milliseconds
  constructor({lock_time = 1000 * 60, retry_interval = 1000} = {}) {
    Mutex.registry = Mutex.registry || Object.create(null);
    this.id = Object.create(null);
    this.lock_time = lock_time;
    this.retry_interval = retry_interval;
  }

  lock(key, {retry = true} = {}) {
    let info = Mutex.registry[key], now = Date.now();
    if (info === undefined || info.id === this.id || info.deadline < now) {
      Mutex.registry[key] = {id: this.id, deadline: now + this.lock_time};
      return Promise.resolve(true);
    }
    return (retry === true || --retry >= 0) ? new Promise(resolve => {
      setTimeout(() => this.lock(key, {retry}), this.retry_interval);
    }) : Promise.resolve(false);
  }

  unlock(key) {
    let info = Mutex.registry[key];
    if (info === undefined || info.id === this.id || info.deadline < Date.now()) {
      delete Mutex.registry[key];
      return true;
    } else {
      return false;
    }
  }
}

function executeContentScript(tab, file, request = {}) {
  // uncomment the following line to enable a breakpoint for Firefox Debugger
  //debugger
  return fetch(browser.runtime.getURL(file)).then(response => {
    return response.text();
  }).then(code => {
    return browser.tabs.executeScript(tab.id, {
      code: code.replace(/\bBACKGROUND_REQUEST\b/, JSON.stringify(request)),
      runAt: request.runAt || 'document_start',
      allFrames: Boolean(request.allFrames),
    });
  }).then(result => {
    if (result) {
      return request.allFrames ? result : result[0];
    }
    return Promise.reject(result);
  }).catch(err => {
    console.error(err);
    throw new ExtensionError(T$('Error_Invalid', tab.title, tab.url));
  });
}
