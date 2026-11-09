// Page logic: the model lives in `model`; the settings list is rebuilt only on structural changes
// (open, add, remove, move, type), typing just updates the model, the errors and the preview.
(function () {
  "use strict";

  var M = window.CsvModel;
  var DRAFT_KEY = "st-modsettings-draft";
  var $ = function (id) { return document.getElementById(id); };
  var model = loadDraft() || starterModel();

  function starterModel() {
    return { displayName: "", settings: [newSetting(1)], extra: [], warnings: [] };
  }

  function newSetting(n) {
    return Object.assign(M.emptySetting(), { key: "Setting" + n, type: "Float", default: "1.0", min: "0.0", max: "10.0" });
  }

  function loadDraft() {
    try {
      var saved = JSON.parse(localStorage.getItem(DRAFT_KEY));
      return saved && Array.isArray(saved.settings) ? Object.assign({ extra: [] }, saved, { warnings: [] }) : null;
    } catch (e) {
      return null;
    }
  }

  function saveDraft() {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(model)); } catch (e) { /* private mode */ }
  }

  // ---- rendering ----

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "text") node.textContent = attrs[k];
      else if (k === "className") node.className = attrs[k];
      else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }

  function field(index, prop, label, control) {
    control.dataset.prop = prop;
    control.addEventListener("input", function () { onEdit(index, prop, control.value); });
    control.addEventListener("change", function () { onEdit(index, prop, control.value); });
    return el("label", { className: "field f-" + prop }, [el("span", { text: label }), control, el("small", { className: "err", "data-err": prop })]);
  }

  function input(value, placeholder) {
    var node = el("input", { type: "text", placeholder: placeholder || "" });
    node.value = value;
    return node;
  }

  function select(options, value) {
    var node = el("select");
    var values = options.map(function (o) { return Array.isArray(o) ? o : [o, o]; });
    if (!values.some(function (o) { return o[0] === value; })) values.unshift([value, value === "" ? "—" : value]);
    values.forEach(function (o) {
      var opt = el("option", { value: o[0], text: o[1] });
      if (o[0] === value) opt.selected = true;
      node.appendChild(opt);
    });
    return node;
  }

  function defaultControl(s) {
    if (s.type === "Bool") return select(["true", "false"], s.default);
    if (s.type === "Choice") {
      return select(M.choiceList(s).map(function (o, i) { return [String(i), i + " — " + o]; }), s.default);
    }
    return input(s.default);
  }

  function renderSettings() {
    var list = $("settings");
    list.textContent = "";
    model.settings.forEach(function (s, i) {
      var numeric = s.type === "Int" || s.type === "Float";
      var tools = el("div", { className: "tools" }, [
        el("button", { className: "icon", title: "Move up", "data-act": "up", text: "↑" }),
        el("button", { className: "icon", title: "Move down", "data-act": "down", text: "↓" }),
        el("button", { className: "icon danger", title: "Remove", "data-act": "remove", text: "✕" }),
      ]);
      tools.addEventListener("click", function (e) {
        var act = e.target.dataset && e.target.dataset.act;
        if (act) onTool(i, act);
      });
      var card = el("div", { className: "card setting", "data-index": i }, [
        el("div", { className: "card-head" }, [el("span", { className: "num", text: "#" + (i + 1) }), tools]),
        el("div", { className: "grid" }, [
          field(i, "key", "Key", input(s.key, "SettingKey")),
          field(i, "type", "Type", select(M.TYPES, s.type)),
          field(i, "label", "Label", input(s.label, "Setting name")),
          field(i, "default", "Default", defaultControl(s)),
          numeric ? field(i, "min", "Min", input(s.min)) : null,
          numeric ? field(i, "max", "Max", input(s.max)) : null,
          numeric ? field(i, "step", "Step", input(s.step)) : null,
          s.type === "Choice" ? field(i, "choices", "Choices", input(s.choices, "Option 1;Option 2")) : null,
          field(i, "order", "Order", input(s.order)),
          field(i, "applyOn", "Apply on", select([["", "—"], "Live", "WorldReload"], s.applyOn)),
          field(i, "description", "Description", input(s.description)),
        ]),
      ]);
      list.appendChild(card);
    });
    refresh();
  }

  function renderAll() {
    $("displayName").value = model.displayName;
    var warnings = $("warnings");
    warnings.hidden = !model.warnings.length;
    warnings.textContent = "";
    model.warnings.forEach(function (w) { warnings.appendChild(el("div", { text: w })); });
    renderSettings();
  }

  // Errors, preview and draft; called after every edit.
  function refresh() {
    var errors = M.validateModel(model);
    document.querySelectorAll(".setting").forEach(function (card) {
      card.classList.remove("bad");
      card.querySelectorAll("[data-err]").forEach(function (n) { n.textContent = ""; });
    });
    errors.forEach(function (e) {
      var card = document.querySelector('.setting[data-index="' + e.setting + '"]');
      if (!card) return;
      card.classList.add("bad");
      var slot = card.querySelector('[data-err="' + e.field + '"]');
      if (slot) slot.textContent = e.message;
    });
    var bad = {};
    errors.forEach(function (e) { bad[e.setting] = true; });
    var count = Object.keys(bad).length;
    var status = $("status");
    status.textContent = count ? count + " with errors" : "OK";
    status.className = "status " + (count ? "warn" : "ok");
    $("csv").textContent = M.toCsvText(model);
    saveDraft();
  }

  // ---- events ----

  function onEdit(index, prop, value) {
    var s = model.settings[index];
    if (s[prop] === value) return;
    if (prop === "type") {
      M.changeType(s, value);
      renderSettings();
      return;
    }
    s[prop] = value;
    if (prop === "choices") {
      var card = document.querySelector('.setting[data-index="' + index + '"] .f-default');
      var fresh = field(index, "default", "Default", defaultControl(s));
      card.replaceWith(fresh);
      refresh();
    } else {
      refresh();
    }
  }

  function onTool(index, act) {
    var list = model.settings;
    if (act === "remove") list.splice(index, 1);
    if (act === "up" && index > 0) list.splice(index - 1, 0, list.splice(index, 1)[0]);
    if (act === "down" && index < list.length - 1) list.splice(index + 1, 0, list.splice(index, 1)[0]);
    renderSettings();
  }

  function openText(text) {
    model = M.fromCsv(text);
    renderAll();
  }

  function openFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () { openText(String(reader.result)); };
    reader.readAsText(file);
  }

  $("displayName").addEventListener("input", function (e) { model.displayName = e.target.value; refresh(); });

  $("add").addEventListener("click", function () {
    model.settings.push(newSetting(model.settings.length + 1));
    renderSettings();
    var cards = document.querySelectorAll(".setting");
    cards[cards.length - 1].querySelector("input").focus();
  });

  $("renumber").addEventListener("click", function () {
    model.settings.forEach(function (s, i) { s.order = String((i + 1) * 10); });
    renderSettings();
  });

  $("new").addEventListener("click", function () {
    if (confirm("Clear the table?")) {
      model = starterModel();
      renderAll();
    }
  });

  $("file").addEventListener("change", function (e) { openFile(e.target.files[0]); e.target.value = ""; });

  $("download").addEventListener("click", function () {
    // BOM so the Mod Kit reads non-Latin labels as UTF-8.
    var blob = new Blob(["﻿" + M.toCsvText(model)], { type: "text/csv;charset=utf-8" });
    var a = el("a", { href: URL.createObjectURL(blob), download: "ST_ModSettings.csv" });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  });

  var drop = $("drop");
  var depth = 0;
  window.addEventListener("dragenter", function (e) { e.preventDefault(); depth++; drop.hidden = false; });
  window.addEventListener("dragleave", function () { if (--depth <= 0) { depth = 0; drop.hidden = true; } });
  window.addEventListener("dragover", function (e) { e.preventDefault(); });
  window.addEventListener("drop", function (e) {
    e.preventDefault();
    depth = 0;
    drop.hidden = true;
    openFile(e.dataTransfer.files[0]);
  });

  renderAll();
})();
