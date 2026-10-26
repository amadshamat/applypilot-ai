import type { FillInstruction, FillReport, FillStatus } from '@applypilot/shared';
import { classifyQuestion } from '@applypilot/ai-core';
import {
  REF_ATTRIBUTE,
  deepQueryAll,
  groupLabel,
  isInput,
  isSelect,
  isSubmitLike,
  isTextArea,
  isVisible,
  labelFor,
  readableDocuments,
} from './dom';
import { matchOption } from './options';
import { formChanges } from './scan';
import { clean, cleanLabel, normalize } from './text';

/**
 * Fills the fields the user approved, one at a time, and reports what
 * happened to each. It types into inputs the way a person would (so React and
 * other frameworks notice), picks options in dropdowns, and ticks boxes.
 *
 * It never submits or advances the application: it clicks nothing but
 * options, radios and checkboxes, refuses any click that would reach a
 * Submit, Next or Apply control, and while it runs it stops every form
 * submission on the page.
 */

export interface FillOptions {
  /** How long to wait for a dropdown's options to appear. */
  optionTimeoutMs?: number;
  /** How long the submission guard stays on after the last field. */
  settleMs?: number;
  now?: () => Date;
}

interface Outcome {
  status: FillStatus;
  message: string;
  /** The option that was picked, for dropdowns. */
  picked?: string;
}

const TEXT_LIKE: readonly string[] = [
  'text',
  'email',
  'tel',
  'url',
  'number',
  'date',
  'month',
  'textarea',
  'select',
];

/** Read through a function so the compiler does not assume a click left it unchanged. */
function isChecked(box: HTMLInputElement): boolean {
  return box.checked;
}

function membersOf(docs: Document[], ref: string): Element[] {
  return docs.flatMap((d) => deepQueryAll(d, `[${REF_ATTRIBUTE}="${ref}"]`));
}

function view(el: Element): Window & typeof globalThis {
  const win = el.ownerDocument.defaultView;
  if (!win) throw new Error('The field is not in a live page.');
  return win;
}

function fire(el: Element, type: string) {
  const win = view(el);
  if (type === 'blur' || type === 'focusout' || type === 'focus' || type === 'focusin') {
    el.dispatchEvent(
      new win.FocusEvent(type, { bubbles: type.startsWith('focus') && type !== 'focus' }),
    );
    return;
  }
  if (type.startsWith('mouse') || type.startsWith('pointer')) {
    const Ctor =
      type.startsWith('pointer') && 'PointerEvent' in win ? win.PointerEvent : win.MouseEvent;
    el.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, composed: true }));
    return;
  }
  el.dispatchEvent(new win.Event(type, { bubbles: true, cancelable: false, composed: true }));
}

/**
 * Sets a value through the element's own prototype setter, bypassing the
 * per-instance setter React installs, then announces it with input and change
 * events, so controlled components update their state.
 */
function setNativeValue(
  el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
) {
  const proto = Object.getPrototypeOf(el) as object;
  // Reflect.set with the element as receiver runs the prototype's setter on it.
  if (!Reflect.set(proto, 'value', value, el)) el.value = value;
}

function typeInto(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  el.focus();
  fire(el, 'focusin');
  setNativeValue(el, value);
  fire(el, 'input');
  fire(el, 'change');
  fire(el, 'blur');
  fire(el, 'focusout');
}

/** Clicks an option, radio or checkbox; refuses anything that submits or advances. */
function safeClick(el: Element): boolean {
  if (isSubmitLike(el)) return false;
  fire(el, 'pointerdown');
  fire(el, 'mousedown');
  fire(el, 'pointerup');
  fire(el, 'mouseup');
  (el as HTMLElement).click();
  return true;
}

function nextFrame(el: Element): Promise<void> {
  return new Promise((resolve) => view(el).setTimeout(resolve, 0));
}

/** Resolves with the first non-empty result of `find`, re-checking whenever the page changes. */
function waitFor<T>(doc: Document, find: () => T | null, timeoutMs: number): Promise<T | null> {
  const first = find();
  if (first) return Promise.resolve(first);
  const win = doc.defaultView;
  if (!win) return Promise.resolve(null);
  return new Promise((resolve) => {
    const observer = new win.MutationObserver(() => {
      const found = find();
      if (found) {
        observer.disconnect();
        win.clearTimeout(timer);
        resolve(found);
      }
    });
    observer.observe(doc, { subtree: true, childList: true, attributes: true });
    const timer = win.setTimeout(() => {
      observer.disconnect();
      resolve(find());
    }, timeoutMs);
  });
}

/** Options shown for a dropdown: in the list it controls, or any visible option list. */
function visibleOptions(trigger: Element): Element[] {
  const root = trigger.getRootNode() as Document | ShadowRoot;
  const ids = clean(
    `${trigger.getAttribute('aria-controls') ?? ''} ${trigger.getAttribute('aria-owns') ?? ''}`,
  );
  const controlled = ids
    .split(' ')
    .filter(Boolean)
    .flatMap((id) => {
      const list = root.getElementById(id) ?? trigger.ownerDocument.getElementById(id);
      return list ? [...list.querySelectorAll('[role="option"]')] : [];
    })
    .filter((o) => isVisible(o));
  if (controlled.length > 0) return controlled;
  return deepQueryAll(trigger.ownerDocument, '[role="option"]').filter(
    (o) => isVisible(o) && o.getAttribute('aria-disabled') !== 'true',
  );
}

function optionText(el: Element): { value: string; label: string } {
  const label = clean(el.textContent || el.getAttribute('aria-label'));
  return { value: el.getAttribute('data-value') ?? label, label };
}

async function pickFromList(
  trigger: Element,
  wanted: { value: string; label: string },
  timeoutMs: number,
): Promise<Outcome> {
  const match = await waitFor(
    trigger.ownerDocument,
    () => {
      const options = visibleOptions(trigger);
      if (options.length === 0) return null;
      const found = matchOption(options.map(optionText), [wanted.label, wanted.value]);
      return found
        ? (options.find((o) => optionText(o).label === found.option.label) ?? null)
        : null;
    },
    timeoutMs,
  );
  if (!match) {
    trigger.dispatchEvent(
      new (view(trigger).KeyboardEvent)('keydown', { key: 'Escape', bubbles: true }),
    );
    return {
      status: 'failed',
      message: `No option matching "${wanted.label}" appeared. Pick it yourself.`,
    };
  }
  if (!safeClick(match)) {
    return {
      status: 'unsupported',
      message: 'This option looks like a submit button, so ApplyPilot did not click it.',
    };
  }
  await nextFrame(trigger);
  const picked = optionText(match).label;
  return { status: 'filled', message: `Picked "${picked}".`, picked };
}

function labelStillMatches(el: Element, expected: string, control: string): boolean {
  const now = normalize(cleanLabel(control === 'button-group' ? groupLabel(el) : labelFor(el)));
  const before = normalize(expected);
  if (!before || !now) return true;
  return now === before || now.includes(before) || before.includes(now);
}

const PERSONAL_ID = /\b(social security|ssn|date of birth|birth ?date)\b/i;

/** Personal topics the fill step refuses as well: the review never offers them either. */
const REFUSED_PERSONAL = new Set(['pay expectations']);

const GROUPS: readonly string[] = ['radio-group', 'checkbox-group', 'button-group'];

/** The answers a group offers, as the page shows them now (a "Male / Female" group is demographic). */
function choiceText(members: Element[]): string {
  const choices = members.filter((m) =>
    m.matches(
      'input[type="radio"], input[type="checkbox"], [role="radio"], button, [role="button"]',
    ),
  );
  if (choices.length > 12) return '';
  return choices.map((c) => labelFor(c) || clean(c.textContent)).join(' ');
}

/**
 * The fill step re-checks every instruction on its own, because the page is
 * untrusted and may have changed (or tampered with the ref attributes) since
 * the scan: it refuses sensitive questions, password and hidden inputs, and
 * fields that are no longer visible.
 */
function refusal(instruction: FillInstruction, members: Element[]): string | null {
  const [anchor] = members;
  if (!anchor) return null;
  const group = GROUPS.includes(instruction.control);
  const current = group
    ? `${groupLabel(anchor, instruction.control === 'button-group' ? [] : members)} ${choiceText(members)}`
    : labelFor(anchor);
  for (const text of [instruction.label, current]) {
    if (!text.trim()) continue;
    const question = classifyQuestion(text);
    if (
      question.category === 'sensitive' ||
      REFUSED_PERSONAL.has(question.topic) ||
      PERSONAL_ID.test(text)
    ) {
      return `This asks about ${question.topic || 'personal identification'}. ApplyPilot never fills it; answer it yourself.`;
    }
  }
  if (isInput(anchor)) {
    const type = anchor.type.toLowerCase();
    if (type === 'password') return 'ApplyPilot never fills password fields.';
    if (type === 'hidden') return 'The field is hidden. Scan again.';
  }
  if (
    (isInput(anchor) || isTextArea(anchor)) &&
    TEXT_LIKE.includes(instruction.control) &&
    !isVisible(anchor)
  ) {
    return 'The field is hidden now. Scan again.';
  }
  return null;
}

async function fillOne(
  instruction: FillInstruction,
  members: Element[],
  timeoutMs: number,
): Promise<Outcome> {
  const [el] = members;
  if (!el) return { status: 'failed', message: 'The field is no longer on the page. Scan again.' };
  const { action, control } = instruction;

  switch (control) {
    case 'text':
    case 'email':
    case 'tel':
    case 'url':
    case 'number':
    case 'date':
    case 'month':
    case 'textarea': {
      if (action.type !== 'text') break;
      if (!isInput(el) && !isTextArea(el)) break;
      const input = el;
      if (input.disabled || input.readOnly)
        return { status: 'skipped', message: 'The field is read-only now.' };
      typeInto(input, action.value);
      await nextFrame(input);
      if (input.value === action.value) return { status: 'filled', message: '' };
      if (input.value.trim())
        return {
          status: 'filled',
          message: `The page formatted it as "${input.value.slice(0, 80)}".`,
        };
      return { status: 'failed', message: 'The page did not accept the value. Type it yourself.' };
    }
    case 'select': {
      if (action.type !== 'choose' || !isSelect(el)) break;
      const select = el;
      const option =
        [...select.options].find((o) => o.value === action.value) ??
        [...select.options].find((o) => clean(o.textContent) === action.label);
      if (!option)
        return { status: 'failed', message: `The option "${action.label}" is no longer offered.` };
      select.focus();
      setNativeValue(select, option.value);
      fire(select, 'input');
      fire(select, 'change');
      fire(select, 'blur');
      await nextFrame(select);
      return select.value === option.value
        ? { status: 'filled', message: '' }
        : { status: 'failed', message: 'The page did not accept the choice. Pick it yourself.' };
    }
    case 'radio-group': {
      if (action.type !== 'choose') break;
      const choices = members.filter((m) => m.matches('input[type="radio"], [role="radio"]'));
      const target =
        choices.find(
          (c) =>
            (c as HTMLInputElement).value === action.value ||
            c.getAttribute('data-value') === action.value,
        ) ??
        choices.find(
          (c) => normalize(labelFor(c) || clean(c.textContent)) === normalize(action.label),
        );
      if (!target)
        return { status: 'failed', message: `The choice "${action.label}" is no longer offered.` };
      const checked = () =>
        isInput(target) ? target.checked : target.getAttribute('aria-checked') === 'true';
      if (!checked() && !safeClick(target)) {
        return {
          status: 'unsupported',
          message: 'This choice looks like a submit button, so it was not clicked.',
        };
      }
      await nextFrame(target);
      return checked()
        ? { status: 'filled', message: '' }
        : { status: 'failed', message: 'The choice did not stick. Pick it yourself.' };
    }
    case 'checkbox': {
      if (action.type !== 'check') break;
      const isChecked = () =>
        isInput(el) ? el.checked : el.getAttribute('aria-checked') === 'true';
      if (isChecked() !== action.checked && !safeClick(el)) {
        return {
          status: 'unsupported',
          message: 'This box looks like a submit button, so it was not clicked.',
        };
      }
      await nextFrame(el);
      return isChecked() === action.checked
        ? { status: 'filled', message: '' }
        : { status: 'failed', message: 'The box did not change. Set it yourself.' };
    }
    case 'checkbox-group': {
      if (action.type !== 'choose-many') break;
      let missed = 0;
      for (const box of members.filter((m) =>
        m.matches('input[type="checkbox"]'),
      ) as HTMLInputElement[]) {
        if (action.values.includes(box.value) && !box.checked) {
          safeClick(box);
          if (!isChecked(box)) missed += 1;
        }
      }
      await nextFrame(el);
      return missed === 0
        ? { status: 'filled', message: '' }
        : { status: 'failed', message: `${missed} box${missed === 1 ? '' : 'es'} did not change.` };
    }
    case 'combobox': {
      if (action.type !== 'choose' && action.type !== 'text') break;
      const input = el as HTMLInputElement;
      const wanted =
        action.type === 'choose'
          ? { value: action.value, label: action.label }
          : { value: action.value, label: action.value };
      const before = input.value;
      fire(input, 'mousedown');
      // Type without leaving the box: many typeaheads close and clear on blur.
      input.focus();
      fire(input, 'focusin');
      setNativeValue(input, wanted.label);
      fire(input, 'input');
      const outcome = await pickFromList(input, wanted, timeoutMs);
      if (outcome.status !== 'filled' && input.value === wanted.label) {
        // Leave the box as it was rather than with half-typed text.
        setNativeValue(input, before);
        fire(input, 'input');
      }
      return outcome;
    }
    case 'listbox-button': {
      if (action.type !== 'choose') break;
      if (isSubmitLike(el)) {
        return {
          status: 'unsupported',
          message:
            'This dropdown is built as a submit button, so ApplyPilot will not open it. Pick the option yourself.',
        };
      }
      if (normalize(el.textContent) === normalize(action.label))
        return { status: 'filled', message: 'Already selected.' };
      safeClick(el);
      const outcome = await pickFromList(el, action, timeoutMs);
      if (outcome.status !== 'filled' && el.getAttribute('aria-expanded') === 'true') {
        // Escape did not close it; the trigger toggles it shut, as a person would.
        safeClick(el);
      }
      if (outcome.status === 'filled') {
        await nextFrame(el);
        const shown = normalize(el.textContent);
        const picked = normalize(outcome.picked ?? action.label);
        if (shown && !shown.includes(picked) && !picked.includes(shown)) {
          return {
            status: 'failed',
            message: `The dropdown shows "${clean(el.textContent).slice(0, 60)}". Check it.`,
          };
        }
      }
      return outcome;
    }
    case 'button-group': {
      if (action.type !== 'choose') break;
      const buttons = members.slice(1);
      const target =
        buttons.find((b) => b.getAttribute('data-value') === action.value) ??
        buttons.find((b) => normalize(clean(b.textContent)) === normalize(action.label)) ??
        buttons.find((b) => normalize(clean(b.textContent)) === normalize(action.value));
      if (!target)
        return { status: 'failed', message: `The answer "${action.label}" is no longer offered.` };
      if (!isVisible(target) || target.matches(':disabled, [aria-disabled="true"]'))
        return { status: 'skipped', message: 'The answer button cannot be clicked now.' };
      const stateful = buttons.some((b) =>
        ['aria-pressed', 'aria-checked', 'aria-selected'].some((n) => b.hasAttribute(n)),
      );
      const pressed = () =>
        ['aria-pressed', 'aria-checked', 'aria-selected'].some(
          (n) => target.getAttribute(n) === 'true',
        );
      if (stateful && pressed()) return { status: 'filled', message: 'Already selected.' };
      if (!safeClick(target)) {
        return {
          status: 'unsupported',
          message: 'This answer button looks like a submit button, so it was not clicked.',
        };
      }
      await nextFrame(target);
      if (!stateful) {
        return {
          status: 'filled',
          message: `Clicked "${action.label}". Check that the page shows it selected.`,
        };
      }
      return pressed()
        ? { status: 'filled', message: '' }
        : { status: 'failed', message: 'The answer did not stick. Click it yourself.' };
    }
    case 'file': {
      if (action.type !== 'file' || !isInput(el)) break;
      const win = view(el);
      if (typeof win.DataTransfer !== 'function') {
        return {
          status: 'unsupported',
          message: 'This browser cannot attach files for you. Attach it yourself.',
        };
      }
      const bytes = Uint8Array.from(win.atob(action.base64), (c) => c.charCodeAt(0));
      const file = new win.File([bytes], action.fileName, { type: action.mimeType });
      const transfer = new win.DataTransfer();
      transfer.items.add(file);
      const input = el;
      input.files = transfer.files;
      fire(input, 'input');
      fire(input, 'change');
      await nextFrame(input);
      return input.files.length > 0 && input.files[0]?.name === action.fileName
        ? { status: 'filled', message: `Attached ${action.fileName}.` }
        : { status: 'failed', message: 'The page did not take the file. Attach it yourself.' };
    }
  }
  return { status: 'unsupported', message: 'This kind of field cannot be filled with this value.' };
}

/**
 * Blocks form submission and synthetic clicks on Submit/Next/Apply controls
 * while ApplyPilot fills. A person's own clicks (trusted events) are never
 * blocked.
 */
function installGuard(docs: Document[]): { blocked: () => number; remove: () => void } {
  let blocked = 0;
  const onSubmit = (event: Event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    blocked += 1;
  };
  const onClick = (event: Event) => {
    const target = event.target as Element | null;
    if (
      !event.isTrusted &&
      target &&
      typeof target.closest === 'function' &&
      isSubmitLike(target)
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
      blocked += 1;
    }
  };
  for (const d of docs) {
    d.addEventListener('submit', onSubmit, true);
    d.addEventListener('click', onClick, true);
  }
  return {
    blocked: () => blocked,
    remove: () => {
      for (const d of docs) {
        d.removeEventListener('submit', onSubmit, true);
        d.removeEventListener('click', onClick, true);
      }
    },
  };
}

export async function fillForm(
  doc: Document,
  instructions: readonly FillInstruction[],
  options: FillOptions = {},
): Promise<FillReport> {
  const timeoutMs = options.optionTimeoutMs ?? 2_000;
  const docs = readableDocuments(doc);
  const before = formChanges(doc).newFields;
  const guard = installGuard(docs);
  const results: FillReport['results'] = [];

  try {
    for (const instruction of instructions) {
      const members = membersOf(docs, instruction.ref);
      if (members.length === 0) {
        results.push({
          ref: instruction.ref,
          status: 'failed',
          message: 'The field is no longer on the page. Scan again.',
        });
        continue;
      }
      const refused = refusal(instruction, members);
      if (refused) {
        results.push({ ref: instruction.ref, status: 'skipped', message: refused });
        continue;
      }
      const [anchor] = members;
      if (
        anchor &&
        (TEXT_LIKE.includes(instruction.control) || instruction.control === 'button-group') &&
        !labelStillMatches(anchor, instruction.label, instruction.control)
      ) {
        results.push({
          ref: instruction.ref,
          status: 'failed',
          message: 'The page changed since the scan. Scan again.',
        });
        continue;
      }
      try {
        const outcome = await fillOne(instruction, members, timeoutMs);
        results.push({
          ref: instruction.ref,
          status: outcome.status,
          message: outcome.message.slice(0, 300),
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        results.push({
          ref: instruction.ref,
          status: 'failed',
          message: `Could not fill: ${detail}`.slice(0, 300),
        });
      }
    }
    // Scripts react to changes asynchronously; keep the guard on while they do.
    const settle = options.settleMs ?? 300;
    if (settle > 0) await new Promise((resolve) => setTimeout(resolve, settle));
  } finally {
    guard.remove();
  }

  // Fields the scan did not see: questions the answers revealed.
  const after = formChanges(doc).newFields;
  return {
    results,
    blockedSubmissions: guard.blocked(),
    newFields: Math.max(0, after - before),
    filledAt: (options.now?.() ?? new Date()).toISOString(),
  };
}
