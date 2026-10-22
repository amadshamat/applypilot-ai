import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { fillForm, proposeAnswers, scanForm, toFillAction, toInstruction } from '../src';
import { sampleProfile } from './helpers';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const seen: Record<string, string> = {};

function Controlled({ id, label, type = 'text' }: { id: string; label: string; type?: string }) {
  const [value, setValue] = useState('');
  seen[id] = value;
  return (
    <>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
        }}
      />
    </>
  );
}

/** A dropdown whose options exist only while it is open, like many design-system selects. */
function CustomSelect({ label, options }: { label: string; options: string[] }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  seen[label] = value;
  return (
    <div>
      <span id="sel-label">{label}</span>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby="sel-label"
        aria-controls="sel-list"
        onClick={() => {
          setOpen(!open);
        }}
      >
        {value || 'Select…'}
      </button>
      {open && (
        <ul id="sel-list" role="listbox">
          {options.map((o) => (
            <li
              key={o}
              role="option"
              aria-selected={o === value}
              onClick={() => {
                setValue(o);
                setOpen(false);
              }}
            >
              {o}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Application({ onSubmit }: { onSubmit: () => void }) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <h2>Contact</h2>
      <Controlled id="name" label="Full name" />
      <Controlled id="email" label="Email" type="email" />
      <CustomSelect label="State" options={['California', 'Virginia', 'Washington']} />
      <button type="submit">Submit application</button>
    </form>
  );
}

let container: HTMLDivElement | null = null;
afterEach(() => {
  container?.remove();
  container = null;
});

describe('filling a React application', () => {
  it('updates React state for controlled inputs and custom dropdowns, and never submits', async () => {
    container = document.createElement('div');
    document.body.append(container);
    let submits = 0;
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <Application
          onSubmit={() => {
            submits += 1;
          }}
        />,
      );
      await Promise.resolve();
    });

    const scan = scanForm(document);
    expect(scan.fields.map((f) => `${f.label}:${f.control}`)).toEqual([
      'Full name:text',
      'Email:email',
      'State:listbox-button',
    ]);
    const proposals = proposeAnswers(scan, {
      profile: sampleProfile(),
      resume: null,
      coverLetter: null,
    });
    // The state dropdown's options are not rendered until it opens, so it is offered for review.
    expect(proposals.map((p) => p.status)).toEqual(['ready', 'ready', 'review']);
    const instructions = proposals.flatMap((p) => {
      const action = p.value ? toFillAction(p.value) : null;
      return action ? [toInstruction(p.field, action)] : [];
    });

    let report: Awaited<ReturnType<typeof fillForm>> | undefined;
    await act(async () => {
      report = await fillForm(document, instructions, { optionTimeoutMs: 500, settleMs: 20 });
    });
    expect(report?.results.map((r) => r.status)).toEqual(['filled', 'filled', 'filled']);
    expect(seen).toMatchObject({
      name: 'Avery Chen',
      email: 'avery@example.com',
      State: 'Virginia',
    });
    expect(submits).toBe(0);
    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
  });
});
