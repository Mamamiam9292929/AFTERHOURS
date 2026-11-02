/**
 * D5 · Regeln des Geräte-Audits (tests/e2e/device-audit.mjs).
 *
 * Beide Funktionen laufen im Browser (per `page.evaluate` als Quelltext übergeben) und müssen deshalb
 * ohne Importe und ohne Bezug auf diesen Modulbereich auskommen. `undersizedTargets` ist rein und hat
 * einen Unit-Test (tests/unit/audit-rules.test.mjs).
 */

/**
 * Bedienelemente unter der Mindestgröße nach WCAG 2.2, Kriterium 2.5.8 (Stufe AA): 24 × 24 CSS-Pixel.
 * Ausnahmen wie im Kriterium:
 *   - Links im Fließtext (`inline: true`),
 *   - Abstand: Ein Kreis mit 24 px Durchmesser um die Mitte des kleinen Ziels schneidet kein anderes
 *     Ziel und keinen solchen Kreis eines anderen kleinen Ziels.
 * Ziele, die einander enthalten (Knopf in einer verlinkten Karte), gelten nicht als Nachbarn.
 *
 * @param {{ x: number, y: number, width: number, height: number, inline?: boolean }[]} targets
 * @returns {number[]} Indizes der Ziele, die das Kriterium verfehlen
 */
export function undersizedTargets(targets, min = 24) {
  const radius = min / 2;
  const small = (t) => !t.inline && (t.width < min || t.height < min);
  const center = (t) => ({ x: t.x + t.width / 2, y: t.y + t.height / 2 });
  const contains = (a, b) => a.x <= b.x + 0.5 && a.y <= b.y + 0.5 && a.x + a.width >= b.x + b.width - 0.5 && a.y + a.height >= b.y + b.height - 0.5;
  const result = [];
  targets.forEach((t, i) => {
    if (!small(t)) return;
    const c = center(t);
    const clash = targets.some((o, j) => {
      if (j === i || o.inline || contains(o, t) || contains(t, o)) return false;
      if (small(o)) {
        const d = center(o);
        return Math.hypot(c.x - d.x, c.y - d.y) < min;
      }
      const dx = Math.max(o.x - c.x, 0, c.x - (o.x + o.width));
      const dy = Math.max(o.y - c.y, 0, c.y - (o.y + o.height));
      return Math.hypot(dx, dy) < radius;
    });
    if (clash) result.push(i);
  });
  return result;
}

/**
 * Prüft die aktuelle Seite. Läuft im Browser; `undersized` ist `undersizedTargets` von oben.
 * Rückgabe (alles JSON):
 *   overflow     horizontaler Überlauf der Seite in px (Inhalt breiter als der Bildschirm)
 *   culprits     Elemente, die rechts/links über den Bildschirm hinausragen, ohne abgeschnitten zu werden
 *   zoomInputs   Eingabefelder unter 16 px Schrift – iOS Safari zoomt beim Antippen hinein
 *   smallTargets Bedienelemente unter 24 × 24 px ohne Ausnahme (WCAG 2.2, 2.5.8)
 *   under44      Zahl der Bedienelemente unter 44 × 44 px (Empfehlung von Apple, nur Bericht)
 *   tinyText     sichtbarer Text unter 11 px (nur Bericht)
 */
export function auditPage(undersized) {
  const vw = window.innerWidth;
  const describe = (el) => {
    const tag = el.tagName.toLowerCase();
    const testid = el.getAttribute("data-testid");
    const label = el.getAttribute("aria-label") || el.getAttribute("title") || el.getAttribute("placeholder") || (el.textContent || "").trim().replace(/\s+/g, " ");
    const id = el.id ? `#${el.id}` : "";
    return `${tag}${id}${testid ? `[data-testid=${testid}]` : ""}${label ? ` „${label.slice(0, 40)}“` : ""}`;
  };
  const visible = (el) => {
    if (el.closest('[aria-hidden="true"], [inert]')) return false;
    if (typeof el.checkVisibility === "function") return el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
    const style = getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0;
  };

  // 1. Überlauf: Wie breit ist der Inhalt? body hat overflow-x: hidden – iOS Safari lässt trotzdem seitlich wischen.
  const overflow = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - vw;
  const clipped = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (s.overflowX !== "visible" || /paint|strict|content/.test(s.contain)) return true;
      if (s.position === "fixed") return true; // ragt nur über den Bildschirm, verschiebt aber nichts
    }
    return false;
  };
  const culprits = [];
  if (overflow > 1) {
    const out = new Set();
    for (const el of document.body.querySelectorAll("*")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || (r.right <= vw + 1 && r.left >= -1)) continue;
      if (getComputedStyle(el).position === "fixed" || !visible(el) || clipped(el)) continue;
      out.add(el);
    }
    for (const el of out) {
      if (el.parentElement && out.has(el.parentElement)) continue; // nur das äußerste Element nennen
      const r = el.getBoundingClientRect();
      culprits.push({ el: describe(el), right: Math.round(r.right - vw), left: Math.round(r.left) });
      if (culprits.length >= 8) break;
    }
  }

  // 2. Eingabefelder unter 16 px.
  const zoomInputs = [];
  const textInput = 'input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]):not([type="file"]):not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]), textarea, select, [contenteditable="true"]';
  for (const el of document.querySelectorAll(textInput)) {
    if (!visible(el) || el.disabled) continue;
    const size = parseFloat(getComputedStyle(el).fontSize);
    if (size < 16) zoomInputs.push({ el: describe(el), size });
  }

  // 3. Bedienelemente.
  const interactive = 'a[href], button, [role="button"], [role="link"], [role="switch"], [role="tab"], [role="checkbox"], [role="radio"], [role="menuitem"], [role="option"], input:not([type="hidden"]), select, textarea, summary';
  const targets = [];
  const elements = [];
  for (const el of document.querySelectorAll(interactive)) {
    if (el.disabled || !visible(el)) continue;
    let box = el;
    let r = el.getBoundingClientRect();
    // Versteckte Eingabe (sr-only) in einem sichtbaren Label: das Label ist das Ziel.
    if ((r.width <= 2 || r.height <= 2) && el.closest("label")) {
      box = el.closest("label");
      r = box.getBoundingClientRect();
    }
    if (r.width <= 2 || r.height <= 2) continue; // nur für Screenreader
    if (elements.includes(box)) continue;
    const style = getComputedStyle(box);
    const parentText = (box.parentElement?.textContent || "").trim().length;
    const inline = box.tagName === "A" && style.display === "inline" && parentText > (box.textContent || "").trim().length + 1;
    targets.push({ x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height, inline });
    elements.push(box);
  }
  const smallTargets = undersized(targets).map((i) => ({ el: describe(elements[i]), size: `${Math.round(targets[i].width)}×${Math.round(targets[i].height)}` }));
  const under44 = targets.filter((t) => !t.inline && (t.width < 44 || t.height < 44)).length;

  // 4. Sehr kleine Schrift.
  const tinyText = [];
  const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent.trim();
    const el = node.parentElement;
    if (!text || !el || seen.has(el) || !visible(el)) continue;
    seen.add(el);
    const size = parseFloat(getComputedStyle(el).fontSize);
    if (size < 11) tinyText.push({ el: describe(el), size });
  }
  return { width: vw, overflow, culprits, zoomInputs, smallTargets, under44, targets: targets.length, tinyText };
}
