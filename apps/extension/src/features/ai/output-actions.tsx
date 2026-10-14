import { useState } from 'react';
import { Copy, Download } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { downloadText } from './download';

/** Copy and download buttons for a draft. Nothing is ever pasted into a page automatically. */
export function OutputActions({
  text,
  fileName,
  copyLabel = 'Copy',
}: {
  text: string;
  fileName?: string;
  copyLabel?: string;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setMessage('Copied');
    } catch {
      setMessage('Copy failed. Select the text and copy it instead.');
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="secondary" onClick={() => void copy()} disabled={!text}>
        <Copy aria-hidden className="h-3.5 w-3.5" /> {copyLabel}
      </Button>
      {fileName ? (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => downloadText(fileName, text)}
          disabled={!text}
        >
          <Download aria-hidden className="h-3.5 w-3.5" /> Download .txt
        </Button>
      ) : null}
      {message ? (
        <span role="status" className="text-xs text-muted">
          {message}
        </span>
      ) : null}
    </div>
  );
}
