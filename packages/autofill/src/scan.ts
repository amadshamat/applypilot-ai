import type {
  ControlKind,
  DetectedField,
  FieldOption,
  FormChanges,
  FormScan,
} from '@applypilot/shared';
import {
  REF_ATTRIBUTE,
  buttonText,
  deepQueryAll,
  describedBy,
  groupLabel,
  isInput,
  isSelect,
  isSubmitLike,
  isTextArea,
  isVisible,
  labelFor,
  readableDocuments,
  sectionFor,
  textWithoutControls,
} from './dom';
import { FORM_FRAME_HOSTS, detectFormPlatform } from './platforms';
import { clean, cleanLabel, labelMarksRequired, nameWords } from './text';

/**
 * Finds the application form on a page and describes each field: what kind of
 * control it is, the label and section it sits under, its options and what it
 * already holds. Reading is all it does, apart from marking each field with a
 * data attribute so the fill step finds the same element again.
 */

export interface ScanOptions {
  now?: () => Date;
  /**
   * Re-scan: a field still on the page keeps the ref it had, so the answers the
   * user approved stay attached to it. New fields get refs after the highest
   * one in use. A ref that is copied (a cloned block) or split across elements
   * that no longer form one field is dropped, and those fields count as new.
   */
  keepRefs?: boolean;
}

const MAX_FIELDS = 300;
const SKIPPED_INPUT_TYPES = new Set([
  'hidden',
  'password',
  'submit',
  'button',
  'reset',
  'image',
  'search',
  'color',
  'range',
]);
const TEXT_TYPES: Record<string, ControlKind> = {
  text: 'text',
  email: 'email',
  tel: 'tel',
  url: 'url',
  number: 'number',
  date: 'date',
  month: 'month',
  '': 'text',
};

interface Candidate {
  /** The element that represents the field (the input, or the group container). */
  el: Element;
  /** Every element that carries the field's ref (all radios of a group). */
  members: Element[];
  control: ControlKind;
  label: string;
  options: FieldOption[];
  optionsComplete: boolean;
  currentValue: string;
}

const FIELD_SELECTOR =
  'input, select, textarea, [role="combobox"], [aria-haspopup="listbox"], [role="radiogroup"], [role="checkbox"]';

function fillableCount(el: Element): number {
  return deepQueryAll(
    el,
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea, [role="combobox"], [aria-haspopup="listbox"]',
  ).length;
}

/**
 * The form to fill: the <form> with the most fields, or the page body for
 * single-page apps that do not use a <form> element. Search boxes are never it.
 */
function chooseRoot(doc: Document): Element | null {
  const forms = [...doc.querySelectorAll('form')].filter(
    (f) => !f.matches('[role="search"]') && !f.closest('[role="search"], header, nav'),
  );
  const best = forms
    .map((form) => ({ form, count: fillableCount(form) }))
    .sort((a, b) => b.count - a.count)[0];
  const body = doc.body as HTMLElement | null;
  const total = body ? fillableCount(body) : 0;
  if (best && best.count >= 2 && best.count >= total / 2) return best.form;
  return doc.body;
}

function optionLabel(el: Element): string {
  return clean(labelFor(el) || el.getAttribute('value') || textWithoutControls(el));
}

const PLACEHOLDER_OPTION = /^(select|choose|please select|--|—|pick)\b|^$/i;

function selectOptions(select: HTMLSelectElement): FieldOption[] {
  return [...select.options]
    .filter((o) => !(o.value === '' && PLACEHOLDER_OPTION.test(clean(o.textContent))))
    .filter((o) => !o.disabled)
    .slice(0, 300)
    .map((o) => ({ value: o.value.slice(0, 300), label: clean(o.textContent).slice(0, 300) }));
}

function listboxOptions(el: Element): FieldOption[] | null {
  const root = el.getRootNode() as Document | ShadowRoot;
  const ids = clean(
    `${el.getAttribute('aria-controls') ?? ''} ${el.getAttribute('aria-owns') ?? ''}`,
  );
  for (const id of ids.split(' ').filter(Boolean)) {
    const listbox = root.getElementById(id);
    if (!listbox) continue;
    const options = [...listbox.querySelectorAll('[role="option"]')];
    if (options.length > 0) {
      return options.slice(0, 300).map((o) => {
        const label = clean(o.textContent).slice(0, 300);
        return { value: (o.getAttribute('data-value') ?? label).slice(0, 300), label };
      });
    }
  }
  const list = el.getAttribute('list');
  if (list) {
    const datalist = root.getElementById(list);
    if (datalist) {
      return [...datalist.querySelectorAll('option')].slice(0, 300).map((o) => ({
        value: o.value.slice(0, 300),
        label: clean(o.textContent || o.value).slice(0, 300),
      }));
    }
  }
  return null;
}

/** Radios, checkboxes and their labels are often styled so that only the label is visible. */
function choiceVisible(input: Element): boolean {
  if (isVisible(input)) return true;
  const labels = (input as HTMLInputElement).labels;
  return labels ? [...labels].some((l) => isVisible(l)) : false;
}

/** The container shared by every member of a group. */
function commonAncestor(first: Element, members: Element[]): Element {
  let node = first.parentElement;
  while (node && !members.every((m) => node?.contains(m))) node = node.parentElement;
  return node ?? first;
}

function collect(root: Element, skipped: { count: number }): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<Element>();
  const groups = new Map<string, HTMLInputElement[]>();
  const all = deepQueryAll(root, FIELD_SELECTOR);
  const order = new Map(all.map((el, index) => [el, index]));

  for (const el of all) {
    if (seen.has(el)) continue;
    if (
      el.closest('[role="search"]') ||
      (el.closest('header, nav, footer') && root.matches('body'))
    ) {
      continue;
    }

    if (isInput(el)) {
      const type = el.type.toLowerCase();
      if (type === 'password') {
        // Never read or fill passwords.
        skipped.count += 1;
        continue;
      }
      if (SKIPPED_INPUT_TYPES.has(type)) continue;
      if (el.disabled || el.readOnly) {
        if (isVisible(el)) skipped.count += 1;
        continue;
      }
      if (type === 'radio' || type === 'checkbox') {
        if (!choiceVisible(el)) continue;
        const key = `${type}:${el.name || el.id || `unnamed-${out.length}-${groups.size}`}`;
        const list = groups.get(key) ?? [];
        list.push(el);
        groups.set(key, list);
        seen.add(el);
        continue;
      }
      if (type === 'file') {
        // File inputs are usually hidden behind a styled "Attach" button.
        out.push({
          el,
          members: [el],
          control: 'file',
          label: fileLabel(el),
          options: [],
          optionsComplete: true,
          currentValue: el.files && el.files.length > 0 ? clean(el.files[0]?.name) : '',
        });
        seen.add(el);
        continue;
      }
      if (!isVisible(el)) continue;
      const isCombobox =
        el.getAttribute('role') === 'combobox' ||
        el.getAttribute('aria-autocomplete') === 'list' ||
        el.parentElement?.closest('[role="combobox"]') != null;
      const listed = listboxOptions(el);
      const control: ControlKind | undefined = isCombobox ? 'combobox' : TEXT_TYPES[type];
      if (!control) continue;
      out.push({
        el,
        members: [el],
        control,
        label: labelFor(el),
        options: listed ?? [],
        optionsComplete: !isCombobox || listed !== null,
        currentValue: clean(el.value),
      });
      seen.add(el);
      continue;
    }

    if (isSelect(el) || isTextArea(el)) {
      if (!isVisible(el)) continue;
      if (el.disabled || (isTextArea(el) && el.readOnly)) {
        skipped.count += 1;
        continue;
      }
      const selectBox = isSelect(el);
      out.push({
        el,
        members: [el],
        control: selectBox ? 'select' : 'textarea',
        label: labelFor(el),
        options: selectBox ? selectOptions(el) : [],
        optionsComplete: true,
        currentValue: selectBox
          ? el.value
            ? clean(el.selectedOptions[0]?.textContent)
            : ''
          : el.value,
      });
      seen.add(el);
      continue;
    }

    if (!isVisible(el) || el.getAttribute('aria-disabled') === 'true') continue;
    const role = el.getAttribute('role');
    if (role === 'radiogroup') {
      const radios = [...el.querySelectorAll('[role="radio"]')];
      if (radios.length === 0) continue;
      radios.forEach((r) => seen.add(r));
      seen.add(el);
      out.push({
        el,
        members: [el, ...radios],
        control: 'radio-group',
        label: groupLabel(el),
        options: radios.map((r) => {
          const label = clean(r.getAttribute('aria-label') || r.textContent);
          return { value: (r.getAttribute('data-value') ?? label).slice(0, 300), label };
        }),
        optionsComplete: true,
        currentValue: clean(
          radios.find((r) => r.getAttribute('aria-checked') === 'true')?.textContent,
        ),
      });
      continue;
    }
    if (role === 'checkbox') {
      seen.add(el);
      out.push({
        el,
        members: [el],
        control: 'checkbox',
        label: labelFor(el) || clean(el.textContent),
        options: [],
        optionsComplete: true,
        currentValue: el.getAttribute('aria-checked') === 'true' ? 'checked' : '',
      });
      continue;
    }
    // A custom dropdown: role=combobox on a non-input, or a button that opens a listbox.
    if (el.querySelector('input, select')) continue;
    const listed = listboxOptions(el);
    seen.add(el);
    out.push({
      el,
      members: [el],
      control:
        role === 'combobox' && el.matches('[contenteditable], input')
          ? 'combobox'
          : 'listbox-button',
      label: labelFor(el),
      options: listed ?? [],
      optionsComplete: listed !== null,
      currentValue: clean(el.textContent),
    });
  }

  for (const [key, members] of groups) {
    const type = key.split(':')[0];
    const [first] = members;
    if (!first) continue;
    const container = members.length > 1 ? commonAncestor(first, members) : first;
    const options = members.map((m) => ({
      value: (m.value || 'on').slice(0, 300),
      label: optionLabel(m).slice(0, 300),
    }));
    if (type === 'radio') {
      out.push({
        el: container,
        members,
        control: 'radio-group',
        label: groupLabel(container, members) || (members.length === 1 ? labelFor(first) : ''),
        options,
        optionsComplete: true,
        currentValue: clean(options[members.findIndex((m) => m.checked)]?.label),
      });
    } else if (members.length === 1) {
      const box = first;
      out.push({
        el: box,
        members,
        control: 'checkbox',
        label: labelFor(box),
        options: [],
        optionsComplete: true,
        currentValue: box.checked ? 'checked' : '',
      });
    } else {
      out.push({
        el: container,
        members,
        control: 'checkbox-group',
        label: groupLabel(container, members),
        options,
        optionsComplete: true,
        currentValue: members
          .filter((m) => m.checked)
          .map((m) => optionLabel(m))
          .join(', '),
      });
    }
  }

  // Keep page order, as the user sees the fields. Positions come from the walk
  // above, which also orders fields inside web components correctly.
  const position = (c: Candidate) => Math.min(...c.members.map((m) => order.get(m) ?? Infinity));
  return out.sort((a, b) => position(a) - position(b));
}

/** A file input's label, which is often on the upload group rather than the input. */
function fileLabel(input: HTMLInputElement): string {
  const explicit =
    input.labels && input.labels.length > 0
      ? labelFor(input)
      : clean(input.getAttribute('aria-label'));
  if (explicit) return explicit;
  const group = input.closest('[role="group"], fieldset');
  const named = group ? groupLabel(group) : '';
  return named || labelFor(input) || labelFor(input.parentElement ?? input);
}

const CHOICE_BUTTON_TEXT =
  /^(yes|no|maybe|true|false|n\/a|not sure|prefer not to (say|answer)|decline( to answer)?|i don'?t know)$/i;
const CHOICE_BUTTONS = 'button, [role="button"], [role="radio"]';
const PRESSED_STATE = ['aria-pressed', 'aria-checked', 'aria-selected'];

function isPressed(button: Element): boolean {
  return PRESSED_STATE.some((name) => button.getAttribute(name) === 'true');
}

export interface ButtonGroup {
  container: Element;
  buttons: Element[];
  label: string;
}

/**
 * Questions answered by clicking one of a few buttons: Ashby and many custom
 * forms draw Yes/No this way, as toggle buttons (aria-pressed) or role=radio
 * outside a radiogroup. A group counts only when it is 2 to 6 short,
 * visible buttons side by side, none of them a Submit, Next or dropdown
 * button, and either the buttons expose a pressed or checked state or they
 * read as answers (Yes, No, Prefer not to say).
 */
export function buttonGroups(root: Element): ButtonGroup[] {
  const containers = new Set<Element>();
  for (const button of deepQueryAll(root, CHOICE_BUTTONS)) {
    if (button.closest('[role="radiogroup"]')) continue;
    if (button.parentElement) containers.add(button.parentElement);
  }
  const out: ButtonGroup[] = [];
  for (const container of containers) {
    const buttons = [...container.children].filter((c) => c.matches(CHOICE_BUTTONS));
    if (buttons.length < 2 || buttons.length > 6 || !isVisible(container)) continue;
    // Editor toolbars and tabs use pressed buttons too; they are not questions.
    if (
      container.closest('[role="toolbar"], [role="menubar"], [role="tablist"], nav, header, footer')
    )
      continue;
    if (
      !buttons.every(
        (b) =>
          isVisible(b) &&
          buttonText(b).length > 0 &&
          buttonText(b).length <= 40 &&
          !isSubmitLike(b) &&
          !b.matches('[aria-haspopup], [aria-expanded], :disabled, [aria-disabled="true"]') &&
          !b.querySelector('input, select, textarea'),
      )
    ) {
      continue;
    }
    const stateful = buttons.every(
      (b) => b.matches('[role="radio"]') || PRESSED_STATE.some((name) => b.hasAttribute(name)),
    );
    const answers = buttons.some((b) => CHOICE_BUTTON_TEXT.test(buttonText(b)));
    if (!stateful && !answers) continue;
    out.push({ container, buttons, label: cleanLabel(groupLabel(container)) });
  }
  return out;
}

function buttonGroupCandidate(group: ButtonGroup): Candidate {
  const options = group.buttons.map((b) => {
    const label = buttonText(b).slice(0, 300);
    return { value: (b.getAttribute('data-value') ?? label).slice(0, 300), label };
  });
  const pressed = group.buttons.findIndex(isPressed);
  return {
    el: group.container,
    members: [group.container, ...group.buttons],
    control: 'button-group',
    label: group.label,
    options,
    optionsComplete: true,
    currentValue: pressed >= 0 ? (options[pressed]?.label ?? '') : '',
  };
}

/**
 * Every field on the page, in page order: the controls `collect` finds and
 * the button groups. Button groups without a label cannot be told apart from
 * consent or eligibility questions, so they are reported, never offered.
 */
function candidates(
  root: Element,
  skipped: { count: number },
): { fields: Candidate[]; unlabeled: number } {
  const fields = collect(root, skipped);
  let unlabeled = 0;
  for (const group of buttonGroups(root)) {
    if (!group.label) {
      unlabeled += 1;
      continue;
    }
    fields.push(buttonGroupCandidate(group));
  }
  const order = new Map(
    deepQueryAll(root, `${FIELD_SELECTOR}, ${CHOICE_BUTTONS}`).map((el, index) => [el, index]),
  );
  const position = (c: Candidate) => Math.min(...c.members.map((m) => order.get(m) ?? Infinity));
  return { fields: fields.sort((a, b) => position(a) - position(b)), unlabeled };
}

const CONTROLS =
  'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="radio"]):not([type="checkbox"]), select, textarea, [role="combobox"], [aria-haspopup="listbox"]';

/**
 * Signature of a repeatable block: same tag, classes and test hook, and the
 * same field labels inside, so two unrelated sections never count as twins.
 */
function signature(el: Element): string {
  const labels = deepQueryAll(el, CONTROLS)
    .map((c) => cleanLabel(labelFor(c)).toLowerCase())
    .join('/');
  return `${el.tagName}|${el.getAttribute('class') ?? ''}|${el.getAttribute('data-automation-id') ?? ''}|${labels}`;
}

const REPEAT_WORDS =
  /\b(experience|employment|employer|job|work|position|education|school|degree)\b/;

/**
 * Which repeated block (job 1, job 2…) a field belongs to: an ancestor that
 * has siblings of the same shape, each holding several fields. Falls back to
 * an index in the field's name ("experience[1][company]").
 */
function repeatIndex(el: Element, root: Element, words: string): number | null {
  for (
    let node: Element | null = el.parentElement;
    node && node !== root;
    node = node.parentElement
  ) {
    const parent = node.parentElement;
    if (!parent) break;
    if (deepQueryAll(node, CONTROLS).length < 2) continue;
    const sig = signature(node);
    const twins = [...parent.children].filter((c) => isVisible(c) && signature(c) === sig);
    if (twins.length >= 2) {
      const index = twins.indexOf(node);
      if (index >= 0) return Math.min(index, 50);
    }
  }
  if (REPEAT_WORDS.test(words)) {
    const match = /(?:^|\s)(\d{1,2})(?:\s|$)/.exec(words);
    if (match?.[1]) {
      const n = Number(match[1]);
      // Names count from 0 or 1; both mean "the first block" when the form has no 0.
      return Math.min(n, 50);
    }
  }
  return null;
}

function stepInfo(doc: Document): FormScan['step'] {
  const text = clean((doc.body as HTMLElement | null)?.textContent).slice(0, 50_000);
  const match = /\bstep\s+(\d{1,2})\s*(?:of|\/)\s*(\d{1,2})\b/i.exec(text);
  let current: number | null = match ? Number(match[1]) : null;
  let total: number | null = match ? Number(match[2]) : null;
  if (current === null) {
    const bar = doc.querySelector('[role="progressbar"][aria-valuenow][aria-valuemax]');
    const now = Number(bar?.getAttribute('aria-valuenow'));
    const max = Number(bar?.getAttribute('aria-valuemax'));
    if (Number.isInteger(now) && Number.isInteger(max) && max > 1 && max <= 20 && now >= 1) {
      current = now;
      total = max;
    }
  }
  if (current === null) {
    const stepCurrent = doc.querySelector('[aria-current="step"]');
    const list = stepCurrent?.closest('ol, ul');
    if (stepCurrent && list) {
      const items = [...list.children];
      const index = items.findIndex((li) => li.contains(stepCurrent) || li === stepCurrent);
      if (index >= 0) {
        current = index + 1;
        total = items.length;
      }
    }
  }
  const hasNext = deepQueryAll(doc, 'button, [role="button"], input[type="submit"], a').some(
    (b) => isVisible(b) && /^(next|continue|save (?:and|&) continue)\b/i.test(buttonText(b)),
  );
  return {
    current: current && current > 0 ? current : null,
    total: total && total > 0 ? total : null,
    hasNext,
  };
}

const CAPTCHA =
  'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="challenges.cloudflare.com"], .g-recaptcha, .h-captcha, .cf-turnstile, [data-sitekey]';

function blockedFrames(doc: Document, url: string): FormScan['blockedFrames'] {
  const out: FormScan['blockedFrames'] = [];
  for (const frame of doc.querySelectorAll('iframe[src]')) {
    let readable: boolean;
    try {
      readable = (frame as HTMLIFrameElement).contentDocument !== null;
    } catch {
      readable = false;
    }
    if (readable) continue;
    try {
      const src = new URL(frame.getAttribute('src') ?? '', url);
      if (/^https?:$/.test(src.protocol) && FORM_FRAME_HOSTS.test(src.hostname)) {
        out.push({ origin: src.origin, url: src.href.slice(0, 2000) });
      }
    } catch {
      // not an address
    }
    if (out.length >= 5) break;
  }
  return out;
}

export function scanForm(doc: Document, options: ScanOptions = {}): FormScan {
  const url = doc.URL;
  const docs = readableDocuments(doc);
  const marked = new Map<string, Set<Element>>();
  for (const d of docs) {
    for (const el of deepQueryAll(d, `[${REF_ATTRIBUTE}]`)) {
      const ref = el.getAttribute(REF_ATTRIBUTE) ?? '';
      marked.set(ref, (marked.get(ref) ?? new Set()).add(el));
      // Refs are written again below, so a ref always means this scan's field.
      el.removeAttribute(REF_ATTRIBUTE);
    }
  }
  const kept = new Set<string>();
  let next = 1;
  if (options.keepRefs) {
    for (const ref of marked.keys()) {
      const n = /^f(\d{1,4})$/.exec(ref)?.[1];
      if (n) next = Math.max(next, Number(n) + 1);
    }
  }
  /** The ref a field had, if exactly its elements carried it; else a new one. */
  const refFor = (members: Element[]): string => {
    if (options.keepRefs) {
      const ref = [...marked.entries()].find(([, els]) => els.has(members[0] as Element))?.[0];
      const els = ref ? marked.get(ref) : undefined;
      if (
        ref &&
        els &&
        !kept.has(ref) &&
        /^f\d{1,4}$/.test(ref) &&
        els.size === members.length &&
        members.every((m) => els.has(m))
      ) {
        kept.add(ref);
        return ref;
      }
    }
    // Refs are at most four digits; past that, numbering wraps to a fresh scan's.
    if (next > 9999) next = 1;
    let ref = `f${next++}`;
    while (kept.has(ref)) ref = `f${next++}`;
    return ref;
  };

  const skipped = { count: 0 };
  const fields: DetectedField[] = [];
  let title = '';
  const submit = new Set<string>();
  const add = new Set<string>();
  const unsupported: string[] = [];
  let captcha = false;

  for (const d of docs) {
    const root = chooseRoot(d);
    if (!root) continue;
    // The page's main heading names the job; a form's own first heading is often a section.
    title ||= clean((d.querySelector('h1') ?? root.querySelector('h2'))?.textContent).slice(0, 300);
    captcha ||= deepQueryAll(d, CAPTCHA).length > 0;
    const found = candidates(root, skipped);
    if (found.unlabeled > 0) {
      unsupported.push(
        found.unlabeled === 1
          ? 'An unlabeled question with answer buttons'
          : `${found.unlabeled} unlabeled questions with answer buttons`,
      );
    }

    for (const candidate of found.fields) {
      if (fields.length >= MAX_FIELDS) break;
      const ref = refFor(candidate.members);
      candidate.members.forEach((m) => m.setAttribute(REF_ATTRIBUTE, ref));
      const { el } = candidate;
      const rawLabel = candidate.label;
      const placeholder = clean(el.getAttribute('placeholder'));
      const label = cleanLabel(rawLabel || placeholder);
      const words = nameWords(
        el.getAttribute('name') ?? candidate.members[0]?.getAttribute('name'),
        el.getAttribute('id'),
        el.getAttribute('data-automation-id'),
        el.getAttribute('data-testid'),
        el.getAttribute('data-qa'),
      );
      const hint = clean(
        [rawLabel ? placeholder : '', describedBy(el)].filter(Boolean).join(' · '),
      );
      const required =
        candidate.members.some(
          (m) => (m as HTMLInputElement).required || m.getAttribute('aria-required') === 'true',
        ) || labelMarksRequired(rawLabel);
      const maxLength = (el as HTMLInputElement).maxLength;
      const section = sectionFor(el, root);
      fields.push({
        ref,
        control: candidate.control,
        label: label.slice(0, 500),
        hint: hint.slice(0, 500),
        // The job title heading is not a section of the form.
        section: section === title ? '' : section,
        name: words.slice(0, 300),
        autocomplete: clean(el.getAttribute('autocomplete')).toLowerCase().slice(0, 100),
        required,
        options: candidate.options,
        optionsComplete: candidate.optionsComplete,
        currentValue: candidate.currentValue.slice(0, 2000),
        accept: clean(el.getAttribute('accept')).slice(0, 200),
        maxLength: Number.isInteger(maxLength) && maxLength > 0 ? maxLength : null,
        repeatIndex: repeatIndex(el, root, words),
      });
    }

    for (const button of deepQueryAll(d, 'button, input[type="submit"], [role="button"]')) {
      if (!isVisible(button)) continue;
      const text = buttonText(button);
      if (!text) continue;
      if (isSubmitLike(button) && submit.size < 10) submit.add(text);
      else if (
        /^(\+\s*)?add\b(?! to (cart|bag|favou?rites|calendar))/i.test(text) &&
        add.size < 10
      ) {
        add.add(text);
      }
    }
  }

  return {
    url: url.slice(0, 4000),
    platform: detectFormPlatform(url),
    title: (title || clean(doc.title)).slice(0, 300),
    fields,
    skippedCount: skipped.count,
    unsupportedFields: unsupported.slice(0, 50),
    step: stepInfo(doc),
    captcha,
    submitControls: [...submit],
    addControls: [...add],
    blockedFrames: blockedFrames(doc, url),
    scannedAt: (options.now?.() ?? new Date()).toISOString(),
  };
}

/**
 * What changed since the last scan, without changing anything: visible
 * fields that carry no ref (questions revealed since), and refs whose field
 * is gone. Used to tell the user when to scan for new questions.
 */
export function formChanges(doc: Document): FormChanges {
  const docs = readableDocuments(doc);
  let newFields = 0;
  const present = new Set<string>();
  for (const d of docs) {
    const root = chooseRoot(d);
    if (!root) continue;
    for (const candidate of candidates(root, { count: 0 }).fields) {
      const refs = new Set(candidate.members.map((m) => m.getAttribute(REF_ATTRIBUTE)));
      const [ref] = refs;
      if (refs.size === 1 && ref) present.add(ref);
      else newFields += 1;
    }
  }
  const known = new Set(
    docs
      .flatMap((d) => deepQueryAll(d, `[${REF_ATTRIBUTE}]`))
      .map((el) => el.getAttribute(REF_ATTRIBUTE)),
  );
  const removed = [...known].filter((ref) => ref && !present.has(ref)).length;
  return { newFields: Math.min(newFields, 300), removedFields: Math.min(removed, 300) };
}
