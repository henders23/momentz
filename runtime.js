/*
 * Momentz prototype runtime.
 *
 * The screens in this repo were designed on a design canvas as "Design Component"
 * pages (see design/). This small runtime renders that format in a plain browser,
 * so the prototype runs from the repo or GitHub Pages with no build step.
 *
 * Supported: {{ dotted.path }} holes in text and attributes, <sc-for list as>,
 * <sc-if value>, onClick="{{ handler }}", <helmet> (moved into <head>), and a
 * `class Component extends DCLogic` with state, setState and renderVals().
 */
(function () {
  'use strict';

  // Hide the raw template until it has been rendered.
  var hide = document.createElement('style');
  hide.textContent = 'x-dc{display:none!important}';
  document.head.appendChild(hide);

  function DCLogic(props) {
    this.props = props || {};
    this.state = {};
  }
  DCLogic.prototype.setState = function (patch) {
    var next = typeof patch === 'function' ? patch(this.state, this.props) : patch;
    this.state = Object.assign({}, this.state, next);
    if (this.__render) this.__render();
  };
  DCLogic.prototype.forceUpdate = function () {
    if (this.__render) this.__render();
  };
  DCLogic.prototype.renderVals = function () {
    return {};
  };
  window.DCLogic = DCLogic;

  var WHOLE = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/;
  var HOLES = /\{\{\s*([^}]+?)\s*\}\}/g;

  function lookup(path, scope) {
    if (path === 'true') return true;
    if (path === 'false') return false;
    if (path === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(path)) return Number(path);
    if (/^(['"]).*\1$/.test(path)) return path.slice(1, -1);
    return path.split('.').reduce(function (obj, key) {
      return obj == null ? undefined : obj[key];
    }, scope);
  }

  function interpolate(text, scope) {
    return text.replace(HOLES, function (_, path) {
      var v = lookup(path, scope);
      return v == null ? '' : String(v);
    });
  }

  function resolve(value, scope) {
    if (value == null) return undefined;
    var m = value.match(WHOLE);
    return m ? lookup(m[1], scope) : value;
  }

  function renderChildren(node, scope, out) {
    node.childNodes.forEach(function (child) {
      render(child, scope).forEach(function (n) { out.push(n); });
    });
    return out;
  }

  function render(node, scope) {
    if (node.nodeType === 3) {
      var text = node.textContent;
      return [document.createTextNode(text.indexOf('{{') >= 0 ? interpolate(text, scope) : text)];
    }
    if (node.nodeType !== 1) return [];

    var tag = node.localName;

    if (tag === 'sc-for') {
      var list = resolve(node.getAttribute('list'), scope) || [];
      var as = node.getAttribute('as') || 'item';
      var items = [];
      Array.prototype.forEach.call(list, function (item, i) {
        var inner = Object.assign({}, scope);
        inner[as] = item;
        inner.$index = i;
        renderChildren(node, inner, items);
      });
      return items;
    }

    if (tag === 'sc-if') {
      return resolve(node.getAttribute('value'), scope) ? renderChildren(node, scope, []) : [];
    }

    var el = document.createElementNS(node.namespaceURI, node.localName);
    Array.prototype.forEach.call(node.attributes, function (attr) {
      var name = attr.name;
      var value = attr.value;
      if (name.indexOf('hint-') === 0) return;
      if (value.indexOf('{{') < 0) {
        el.setAttribute(name, value);
        return;
      }
      var whole = value.match(WHOLE);
      if (name.indexOf('on') === 0 && whole) {
        var handler = lookup(whole[1], scope);
        if (typeof handler === 'function') {
          el.addEventListener(name.slice(2).toLowerCase(), function (event) {
            handler(event);
          });
        }
        return;
      }
      if (whole) {
        var raw = lookup(whole[1], scope);
        if (raw == null) return;
        if (raw === false && name.indexOf('aria-') !== 0) return;
        el.setAttribute(name, String(raw));
        return;
      }
      el.setAttribute(name, interpolate(value, scope));
    });
    renderChildren(node, scope, []).forEach(function (child) { el.appendChild(child); });
    return [el];
  }

  function boot() {
    var host = document.querySelector('x-dc');
    var script = document.querySelector('script[type="text/x-dc"]');
    if (!host || !script) return;

    var template = document.createElement('template');
    template.innerHTML = host.innerHTML;

    var helmet = template.content.querySelector('helmet');
    if (helmet) {
      Array.prototype.slice.call(helmet.childNodes).forEach(function (child) {
        if (child.nodeType === 1) document.head.appendChild(document.importNode(child, true));
      });
      helmet.parentNode.removeChild(helmet);
    }

    var props = {};
    try {
      var declared = JSON.parse(script.getAttribute('data-props') || '{}');
      Object.keys(declared).forEach(function (key) {
        if (key.charAt(0) !== '$' && declared[key] && 'default' in declared[key]) {
          props[key] = declared[key]['default'];
        }
      });
    } catch (e) {
      console.warn('Momentz runtime: could not read data-props', e);
    }

    var Component = new Function('DCLogic', script.textContent + '\n;return Component;')(DCLogic);
    var instance = new Component(props);
    if (!instance.state) instance.state = {};

    var mount = document.createElement('div');
    mount.setAttribute('data-momentz-screen', '');
    host.parentNode.replaceChild(mount, host);

    instance.__render = function () {
      var scope = Object.assign({}, instance.renderVals() || {});
      var nodes = [];
      template.content.childNodes.forEach(function (child) {
        render(child, scope).forEach(function (n) { nodes.push(n); });
      });
      while (mount.firstChild) mount.removeChild(mount.firstChild);
      nodes.forEach(function (n) { mount.appendChild(n); });
    };
    instance.__render();
    if (typeof instance.componentDidMount === 'function') instance.componentDidMount();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
