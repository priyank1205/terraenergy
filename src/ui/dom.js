// Minimal DOM helpers.

export function h(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "html") e.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
    else if (k === "style" && typeof v === "object") Object.assign(e.style, v);
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return e;
}

export const icon = (name, cls = "icon") => `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

export function section(title, aside = "", ...children) {
  const s = el("section", { class: "section" });
  if (title) s.append(el("div", { class: "section-title", html: `<span>${title}</span>${aside ? `<span class="aside">${aside}</span>` : ""}` }));
  s.append(...children.flat().filter(Boolean));
  return s;
}

export function tabs(items, active, onChange) {
  const wrap = el("div", { class: "tabs", role: "tablist" });
  for (const it of items) {
    const b = el("button", {
      class: "tab", role: "tab", "aria-selected": String(it.key === active),
      style: it.color ? `--tab-c:${it.color}` : null,
    }, it.label);
    b.addEventListener("click", () => onChange(it.key));
    wrap.append(b);
  }
  return wrap;
}
