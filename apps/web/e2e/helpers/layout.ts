import { expect, type Page } from "@playwright/test";

/** RNF09.R2: nenhuma rolagem horizontal (a partir de 360 px). */
export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "a página rola na horizontal").toBeLessThanOrEqual(0);
}

const TARGETS = [
  "button:not([role=checkbox])",
  "[role=button]",
  "[role=combobox]",
  "[role=tab]",
  "input:not([type=hidden]):not([type=checkbox]):not([type=radio])",
  "select",
  "textarea",
].join(",");

const CHECKBOXES = "[role=checkbox], input[type=checkbox], input[type=radio]";

/**
 * Alvos de toque visíveis menores que o mínimo (RNF09.R3, DD-44). Devolve
 * `"<nome acessível ou tag+texto> (<w>x<h>)"` de cada um. As caixas de marcação são medidas
 * contra `checkboxMin` (16 px visíveis; a área útil vem do `after:` e do `label`).
 */
export async function smallTouchTargets(
  page: Page,
  min: number,
  opts: { checkboxMin?: number } = {},
): Promise<string[]> {
  const checkboxMin = opts.checkboxMin ?? 16;
  return page.evaluate(
    ({ targets, checkboxes, min: m, checkboxMin: cm }) => {
      const label = (el: Element, w: number, h: number) => {
        const name =
          el.getAttribute("aria-label") ||
          (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40) ||
          el.getAttribute("placeholder") ||
          el.getAttribute("name") ||
          el.getAttribute("id") ||
          "";
        return `${el.tagName.toLowerCase()} ${name} (${Math.round(w)}x${Math.round(h)})`.replace(
          /\s+/g,
          " ",
        );
      };
      const visible = (el: Element) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        // Campo escondido de leitor de tela (ex.: o input de apoio do Base UI) não é alvo de toque.
        if (el.closest('[aria-hidden="true"]')) return false;
        const s = getComputedStyle(el);
        return s.visibility !== "hidden" && s.display !== "none";
      };
      const out: string[] = [];
      const seen = new Set<Element>();
      for (const el of document.querySelectorAll(targets)) {
        if (seen.has(el) || !visible(el)) continue;
        seen.add(el);
        const r = el.getBoundingClientRect();
        if (r.width < m || r.height < m) out.push(label(el, r.width, r.height));
      }
      for (const el of document.querySelectorAll(checkboxes)) {
        if (seen.has(el) || !visible(el)) continue;
        seen.add(el);
        const r = el.getBoundingClientRect();
        if (r.width < cm || r.height < cm) out.push(label(el, r.width, r.height));
      }
      return out;
    },
    { targets: TARGETS, checkboxes: CHECKBOXES, min, checkboxMin },
  );
}
