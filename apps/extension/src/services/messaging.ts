import {
  fail,
  responseSchemas,
  type BackgroundRequest,
  type ResponseFor,
} from '@applypilot/shared';

export const DEFAULT_MESSAGE_TIMEOUT_MS = 20_000;

type Sender = (message: unknown) => Promise<unknown>;

const chromeSender: Sender = (message) => chrome.runtime.sendMessage(message);

/**
 * Sends a typed request to the service worker and validates the reply.
 * Never throws: transport failures, timeouts and malformed replies all become
 * typed `{ ok: false }` results the UI can render.
 */
export async function sendToBackground<R extends BackgroundRequest>(
  request: R,
  options: { timeoutMs?: number; send?: Sender } = {},
): Promise<ResponseFor<R['type']>> {
  const send = options.send ?? chromeSender;
  const timeoutMs = options.timeoutMs ?? DEFAULT_MESSAGE_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), timeoutMs);
    });
    const raw = await Promise.race([send(request), timeout]);
    if (raw === 'timeout') {
      return fail(
        'TIMEOUT',
        'ApplyPilot took too long to respond. Please try again.',
      ) as ResponseFor<R['type']>;
    }
    const parsed = responseSchemas[request.type].safeParse(raw);
    if (!parsed.success) {
      return fail('INTERNAL', 'Received an unexpected response from the extension.') as ResponseFor<
        R['type']
      >;
    }
    return parsed.data as ResponseFor<R['type']>;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return fail('INTERNAL', `Could not reach the extension background: ${detail}`) as ResponseFor<
      R['type']
    >;
  } finally {
    clearTimeout(timer);
  }
}
