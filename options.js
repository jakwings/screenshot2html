'use strict';

(async () => {
  function ShowError$(err) {
    console.error(err);
    $('#error').textContent = T$('Error', err);
    abort(err);
  }

  try {
    let cfg = await Config.get();

    $$('[i18n-text]').forEach(dom => {
      dom.textContent = T$(dom.getAttribute('i18n-text'));
    });

    $$('input[type="checkbox"]').forEach(async (box) => {
      let opt_id = box.id.replace(/^option_/, '');
      box.checked = cfg[opt_id];
      box.onchange = (event) => {
        Config.set({[opt_id]: box.checked}).catch(ShowError$);
      };
    });
    $$('input[type="number"]').forEach(async (box) => {
      let opt_id = box.id.replace(/^option_/, '');
      box.value = cfg[opt_id];
      box.onchange = (event) => {
        Config.set({[opt_id]: parseInt(box.value, 10)}).catch(ShowError$);
      };
    });
  } catch (err) {
    ShowError$(err);
  }
})();
