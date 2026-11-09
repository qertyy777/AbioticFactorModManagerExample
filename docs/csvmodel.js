// ST_ModSettings CSV: parsing, validation against the manager's rules (docs/AUTHORING.md) and writing.
// A classic script (window.CsvModel) so index.html works from file://; also a CommonJS module for the tests.
(function (root) {
  "use strict";

  var TYPES = ["Bool", "Int", "Float", "Choice"];
  var APPLY_ON = ["Live", "WorldReload"];
  // Field order in the written CSV; which fields a type keeps.
  var FIELDS = [
    ["Type", "type"], ["Default", "default"], ["Min", "min"], ["Max", "max"], ["Step", "step"],
    ["Choices", "choices"], ["Label", "label"], ["Description", "description"], ["Order", "order"],
    ["ApplyOn", "applyOn"],
  ];
  var NUMERIC_ONLY = { min: true, max: true, step: true };
  var KEY_RE = /^[A-Za-z0-9_]+$/;
  var INT_RE = /^-?\d+$/;
  var FLOAT_RE = /^-?(\d+\.?\d*|\.\d+)$/;

  function emptySetting() {
    return {
      key: "", type: "Float", default: "", min: "", max: "", step: "", choices: "",
      label: "", description: "", order: "", applyOn: "",
    };
  }

  function parseCsv(text) {
    var rows = [];
    var row = [];
    var cell = "";
    var quoted = false;
    var i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
    for (; i < text.length; i++) {
      var c = text[i];
      if (quoted) {
        if (c === '"') {
          if (text[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; }
        } else {
          cell += c;
        }
      } else if (c === '"') {
        quoted = true;
      } else if (c === ",") {
        row.push(cell); cell = "";
      } else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(cell); cell = "";
        rows.push(row); row = [];
      } else {
        cell += c;
      }
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(function (r) { return !(r.length === 1 && r[0] === ""); });
  }

  function quote(value) {
    return /[",\r\n]|^\s|\s$/.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value;
  }

  function toCsv(rows) {
    return rows.map(function (r) { return r.map(quote).join(","); }).join("\r\n") + "\r\n";
  }

  function fromCsv(text) {
    var rows = parseCsv(text);
    var model = { displayName: "", settings: [], extra: [], warnings: [] };
    if (rows.length && rows[0][0] === "Key") {
      rows = rows.slice(1);
    } else {
      model.warnings.push("No Key,SourceString header; reading all rows as settings.");
    }
    var byKey = {};
    var fieldOf = {};
    FIELDS.forEach(function (f) { fieldOf[f[0]] = f[1]; });
    rows.forEach(function (r) {
      var fullKey = r[0] || "";
      var value = r.length > 1 ? r[1] : "";
      var dot = fullKey.indexOf(".");
      var key = dot < 0 ? "" : fullKey.slice(0, dot);
      var field = dot < 0 ? "" : fullKey.slice(dot + 1);
      if (key === "Mod") {
        if (field === "DisplayName") { model.displayName = value; return; }
        if (field === "FormatVersion") {
          if (value !== "1") model.warnings.push("Mod.FormatVersion is " + value + "; it will be saved as 1.");
          return;
        }
      } else if (key && fieldOf[field]) {
        if (!byKey[key]) {
          byKey[key] = emptySetting();
          byKey[key].key = key;
          model.settings.push(byKey[key]);
        }
        byKey[key][fieldOf[field]] = value;
        return;
      }
      model.extra.push([fullKey, value]);
      model.warnings.push("Unknown row " + fullKey + "; kept as is.");
    });
    return model;
  }

  function toCsvText(model) {
    var rows = [["Key", "SourceString"], ["Mod.FormatVersion", "1"]];
    if (model.displayName) rows.push(["Mod.DisplayName", model.displayName]);
    model.settings.forEach(function (s) {
      var numeric = s.type === "Int" || s.type === "Float";
      FIELDS.forEach(function (f) {
        var prop = f[1];
        if (NUMERIC_ONLY[prop] && !numeric) return;
        if (prop === "choices" && s.type !== "Choice") return;
        if (s[prop] === "" || s[prop] == null) return;
        rows.push([s.key + "." + f[0], s[prop]]);
      });
    });
    (model.extra || []).forEach(function (r) { rows.push([r[0], r[1]]); });
    return toCsv(rows);
  }

  function choiceList(s) {
    return s.choices === "" ? [] : s.choices.split(";");
  }

  function validateSetting(s, add) {
    if (!s.key) add("key", "Key is required.");
    else if (!KEY_RE.test(s.key)) add("key", "Key may use Latin letters, digits and _ only.");
    else if (s.key === "Mod") add("key", "Key Mod is reserved for the Mod.* rows.");

    if (TYPES.indexOf(s.type) < 0) {
      add("type", "Type must be Bool, Int, Float or Choice.");
    } else if (s.type === "Bool") {
      if (!/^(true|false|1|0)$/i.test(s.default)) add("default", "Default must be true, false, 1 or 0.");
    } else if (s.type === "Choice") {
      var options = choiceList(s);
      if (!options.length || options.some(function (o) { return o.trim() === ""; })) {
        add("choices", "Choices need at least one option, separated by ; with no empty ones.");
      } else if (!INT_RE.test(s.default) || +s.default < 0 || +s.default >= options.length) {
        add("default", "Default must be an option index from 0 to " + (options.length - 1) + ".");
      }
    } else {
      var re = s.type === "Int" ? INT_RE : FLOAT_RE;
      var what = s.type === "Int" ? "a whole number" : "a number";
      if (!re.test(s.default)) add("default", "Default must be " + what + ".");
      var minOk = re.test(s.min);
      var maxOk = re.test(s.max);
      if (!minOk) add("min", "Min must be " + what + ".");
      if (!maxOk) add("max", "Max must be " + what + ".");
      else if (minOk && +s.min > +s.max) add("max", "Max must not be less than Min.");
      if (s.step !== "" && (!re.test(s.step) || +s.step <= 0)) add("step", "Step must be " + what + " above 0.");
    }

    if (!s.label) add("label", "Label is required.");
    if (s.order !== "" && !INT_RE.test(s.order)) add("order", "Order must be a whole number.");
    if (s.applyOn !== "" && APPLY_ON.indexOf(s.applyOn) < 0) add("applyOn", "ApplyOn must be Live or WorldReload.");
  }

  // Returns [{setting: index, field, message}] in setting order; empty when the manager will accept every setting.
  function validateModel(model) {
    var errors = [];
    var seen = {};
    model.settings.forEach(function (s, i) {
      var add = function (field, message) { errors.push({ setting: i, field: field, message: message }); };
      var lower = s.key.toLowerCase();
      if (s.key && seen[lower]) {
        add("key", "Key " + s.key + " is used twice.");
        var rest = [];
        validateSetting(s, function (f, m) { if (f !== "key") rest.push({ setting: i, field: f, message: m }); });
        errors = errors.concat(rest);
        return;
      }
      if (s.key) seen[lower] = true;
      validateSetting(s, add);
    });
    return errors;
  }

  // Switches the type, keeping values that still fit: 1.0 becomes 1 for Int, Bool/Choice get a valid default.
  function changeType(s, type) {
    s.type = type;
    if (type === "Int") {
      ["default", "min", "max", "step"].forEach(function (p) {
        if (/^-?\d+\.0*$/.test(s[p])) s[p] = String(parseInt(s[p], 10));
      });
    }
    if (type === "Bool" && !/^(true|false|1|0)$/i.test(s.default)) s.default = "true";
    if (type === "Choice" && !INT_RE.test(s.default)) s.default = "0";
  }

  var api = {
    TYPES: TYPES, APPLY_ON: APPLY_ON, emptySetting: emptySetting, parseCsv: parseCsv, toCsv: toCsv,
    fromCsv: fromCsv, toCsvText: toCsvText, validateModel: validateModel, choiceList: choiceList,
    changeType: changeType,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CsvModel = api;
})(this);
