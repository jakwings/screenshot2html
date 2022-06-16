'use strict';

// TODO
// + text.ancestors.lang
// + img.alt (if loading failed)
// + input.value (also <textarea> <button>)
// + select.value
// + element.title
// + all frames <iframe> <frame> <object> <embed>
// + overflowed ? centered ? text-indent ? Window.getComputedStyle()
// + hidden ? (display:none hidden=true width*height=0 parent.hidden)
// + ::before, ::after (window.getComputedStyle(element, '::before').content)
// + <noscript>
// + XHTML documents
// sort by frame, position, z-index; sibling whitespace (Text.wholeText)

function XQuery$(root, xpath) {
  let evaluator = new XPathEvaluator();
  let expression = evaluator.createExpression(xpath);
  let result = expression.evaluate(root, XPathResult.ORDERED_NODE_ITERATOR_TYPE);
  let nodes = [], node = null;
  while (node = result.iterateNext()) nodes.push(node);
  return nodes;
}

function IsHidden$(node, rects, style) {
  if (style.display === 'none') {
    return true;
  }
  if (!(node.value || node.placeHolder || node.length)) {
    return true;
  }
  if (style.userSelect === 'none') {
    if (node.nodeType != document.ELEMENT_NODE) {
      return !node.parentElement.closest('button');
    }
  }
  return Array.from(rects).every(rect => rect.width == 0 || rect.height == 0);
}

function NextLine$(rects, lino, node, offset) {
  switch (node.nodeName) {
    case 'INPUT': case 'TEXTAREA':
      return [node.value || node.placeHolder, -1];
    case 'SELECT':
      return [node.item(node.selectedIndex).textContent, -1];
  }
  if (rects.length > 1) {
    let range = document.createRange();
    for (let i = offset, l = node.length; i < l; ++i) {
      range.setStart(node, 0);
      range.setEnd(node, i + 1);
      if (range.getClientRects().length == lino + 1) {
        return [node.substringData(offset, i - offset), i];
      }
    }
  }
  return [node.substringData(offset, node.length - offset), node.length];
}

function TrimLine$(text, node, style) {
  switch (style.whiteSpace) {
  case 'normal': case 'nowrap': case 'pre-line':
    text = text.trim().replace(/\s+/g, ' ');
    break;
  }
  return /^\s*$/.test(text) ? text : text + ' ';
}

function AddClass$(dom, map, name, style) {
  if (!map.has(style)) {
    map[name] = ((map[name] | 0) || 0) + 1;
    map.set(style, [name, map[name]]);
  }
  let className = map.get(style).join('');
  dom.setAttribute('class', (dom.getAttribute('class') || '') + ' ' + className);
}

function ExtractText$() {
  let z = [], m = new Map();
  let xpath = '//node()[self::text() or self::input or self::textarea or self::select]';
  XQuery$(document, xpath).forEach(node => {
    let elm = node.nodeType != document.ELEMENT_NODE ? node.parentElement : node;
    let style = window.getComputedStyle(elm);
    let range = document.createRange();
    range.selectNode(node);
    let rects = range.getClientRects();
    let lino = 0, offset = 0;
    if (IsHidden$(node, rects, style)) {
      return;
    }
    for (let rect of rects) {
      let s = document.createElement('div');
      let lang = elm.closest('[lang]');
      let title = elm.closest('[title]');
      if (lang) s.lang = lang.lang;
      if (title) s.title = title.title;
      s.setAttribute('style', [
        `top:${(window.scrollY + rect.top).toFixed(0)}px`,
        `width:${Math.abs(rect.width).toFixed(0)}px`,
      ].join(';'));
      //AddClass$(s, m, 'a', `top:${(window.scrollY + rect.top).toFixed(0)}px`);
      AddClass$(s, m, 'b', `left:${(window.scrollX + rect.left).toFixed(0)}px`);
      //AddClass$(s, m, 'c', `width:${Math.abs(rect.width).toFixed(0)}px`);
      AddClass$(s, m, 'd', `height:${Math.abs(rect.height).toFixed(0)}px`);
      // XXX: would be unnecessary easier using javascript and css mix-blend-mode ...
      AddClass$(s, m, 'e', `font-family:${style.fontFamily}`);
      AddClass$(s, m, 'f', `font-weight:${style.fontWeight}`);
      AddClass$(s, m, 'g', `font-size:${style.fontSize}`);
      AddClass$(s, m, 'h', `line-height:${(style.lineHeight || '1.2').replace(/^normal$/, '1.2')}`);
      s.setAttribute('class', s.getAttribute('class').trim());
      [s.textContent, offset] = NextLine$(rects, ++lino, node, offset);
      s.textContent = TrimLine$(s.textContent, node, style);
      z.push(s);
    }
  });
  let style = document.createElement('style');
  style.textContent = Array.from(m.entries()).sort((a, b) => {
    return a[1][0] < b[1][0] ? -1
         : a[1][0] > b[1][0] ? 1
         : a[1][1] < b[1][1] ? -1
         : a[1][1] > b[1][1] ? 1
         : 0;
  }).map(([style, data]) => {
    return `.${data.join('')}{${style}}`;
  }).join('\n');
  let root = document.documentElement;
  let {scrollWidth: sw, scrollHeight: sh} = root;
  let {innerWidth: ww, innerHeight: wh} = window;
  return {
    width: sw || ww,
    height: sh || wh,
    style: style.outerHTML,
    content: z.map(s => s.outerHTML).join('\n'),
  };
}


ExtractText$(BACKGROUND_REQUEST)
