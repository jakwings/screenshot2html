'use strict';

const Config = {

  defaults: {
    url: false,
    file_uri: false,
    jpeg: false,
    quality: 80,
  },

  get: () => {
    return browser.storage.local.get().then(confs => {
      for (let name in Config.defaults) {
        if (confs[name] == null) {
          confs[name] = Config.defaults[name];
        }
      }
      return confs;
    });
  },

  set: (...args) => {
    return browser.storage.local.set(...args);
  },

  addListener: (listener) => {
    return browser.storage.onChanged.addListener(listener);
  },

  removeListener: (listener) => {
    return browser.storage.onChanged.removeListener(listener);
  },

};
