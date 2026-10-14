import { useState, type ComponentProps } from 'react';
import { Input, Textarea } from '../../components/ui/field';
import { splitList } from './format';

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((item, i) => item === b[i]);

/**
 * Edits a list of strings as free text, one item per line (or comma-separated
 * for `variant="comma"`). Keeps the raw text locally so typing a trailing
 * comma or newline is not undone by re-rendering.
 */
export function ListInput({
  value,
  onChange,
  variant,
  ...props
}: {
  value: readonly string[];
  onChange: (value: string[]) => void;
  variant: 'lines' | 'comma';
} & Omit<ComponentProps<'input'> & ComponentProps<'textarea'>, 'value' | 'onChange'>) {
  const separator = variant === 'lines' ? /\n/ : /[,;]/;
  const join = (items: readonly string[]) => items.join(variant === 'lines' ? '\n' : ', ');
  const [text, setText] = useState(() => join(value));

  const [lastValue, setLastValue] = useState(value);
  // Follow outside changes (such as a reset) without fighting the user's typing.
  if (value !== lastValue) {
    setLastValue(value);
    if (!sameList(splitList(text, separator), value)) setText(join(value));
  }

  const handle = (next: string) => {
    setText(next);
    onChange(splitList(next, separator));
  };

  return variant === 'lines' ? (
    <Textarea
      value={text}
      onChange={(event) => handle(event.target.value)}
      rows={Math.min(8, Math.max(3, value.length + 1))}
      {...props}
    />
  ) : (
    <Input value={text} onChange={(event) => handle(event.target.value)} {...props} />
  );
}
