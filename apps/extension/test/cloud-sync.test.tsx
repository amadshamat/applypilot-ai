import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { STORAGE_KEYS } from '@applypilot/shared';
import { LOCAL_TEST_CONNECTION } from '../src/cloud/connection';
import { OFF_STATUS, type SyncStatus } from '../src/cloud/sync-store';
import { SettingsView } from '../src/features/settings/settings-view';
import { ServicesProvider } from '../src/services/services-provider';
import { fakeIdentity } from './cloud-fakes';
import { fakeServices, type FakeOptions } from './fakes';

function renderSettings(options: FakeOptions = {}) {
  const fake = fakeServices(undefined, options);
  render(
    <ServicesProvider services={fake.services}>
      <SettingsView showOpenFullPage={false} />
    </ServicesProvider>,
  );
  return fake;
}

const card = async () => {
  const title = await screen.findByRole('heading', { name: 'Cloud sync (optional)' });
  return within(title.closest('div.rounded-xl') as HTMLElement);
};

async function connectAndSignIn() {
  const c = await card();
  await userEvent.click(c.getByRole('button', { name: 'Use local test server' }));
  await userEvent.click(await c.findByRole('button', { name: /Sign in or create account/ }));
  await c.findByText(/Signed in as/);
  return c;
}

describe('Cloud sync settings', () => {
  it('is off by default and needs no account', async () => {
    const { services } = renderSettings();
    const c = await card();
    expect(c.getByText(/Off by default; resume files are never uploaded/)).toBeInTheDocument();
    expect(await services.cloud.settings.load()).toEqual({ connection: null, syncEnabled: false });
    expect(services.cloud.sync).not.toHaveBeenCalled();
  });

  it('validates deployment addresses before connecting', async () => {
    renderSettings();
    const c = await card();
    await userEvent.type(c.getByLabelText('Cloud API URL (ApiUrl)'), 'https://evil.example.com');
    expect(c.getByText(/Use the ApiUrl from the deployment/)).toBeInTheDocument();
    expect(c.getByRole('button', { name: 'Connect' })).toBeDisabled();
  });

  it('asks for host access, then signs in and turns sync on only when the user chooses', async () => {
    const fake = renderSettings();
    const c = await connectAndSignIn();
    expect(fake.services.cloud.requestOrigins).toHaveBeenCalledWith(['http://127.0.0.1/*']);
    expect(c.getByText('muhaid@example.com')).toBeInTheDocument();
    expect(c.getByText(/Sync is off/)).toBeInTheDocument();
    expect(fake.services.cloud.sync).not.toHaveBeenCalled();

    await userEvent.click(c.getByRole('switch', { name: 'Sync profile and tracker' }));
    await waitFor(() =>
      expect(fake.services.cloud.sync).toHaveBeenCalledWith({ type: 'sync/run' }),
    );
    expect(await fake.services.cloud.settings.load()).toEqual({
      connection: LOCAL_TEST_CONNECTION,
      syncEnabled: true,
    });
    expect(await c.findByText('Up to date.')).toBeInTheDocument();
  });

  it('does not connect without the host permission', async () => {
    const { services } = renderSettings({ cloud: { grantOrigins: false } });
    const c = await card();
    await userEvent.click(c.getByRole('button', { name: 'Use local test server' }));
    expect(await c.findByText(/needs permission to reach these addresses/)).toBeInTheDocument();
    expect((await services.cloud.settings.load()).connection).toBeNull();
  });

  it('stays quiet when the user closes the sign-in window', async () => {
    renderSettings({ cloud: { identity: fakeIdentity('cancel') } });
    const c = await card();
    await userEvent.click(c.getByRole('button', { name: 'Use local test server' }));
    await userEvent.click(await c.findByRole('button', { name: /Sign in or create account/ }));
    expect(await c.findByRole('button', { name: /Sign in or create account/ })).toBeEnabled();
    expect(c.queryByRole('alert')).toBeNull();
  });

  it('lists conflicts and sends the user’s choice', async () => {
    const fake = renderSettings();
    const c = await connectAndSignIn();
    const status: SyncStatus = {
      ...OFF_STATUS,
      state: 'synced',
      conflicts: [
        {
          kind: 'application',
          id: 'rec-1',
          title: 'Cloud Intern at Acme',
          fields: ['job.title'],
          detectedAt: '2026-10-20T12:00:00.000Z',
        },
      ],
    };
    await fake.services.cloud.settings.save({
      connection: LOCAL_TEST_CONNECTION,
      syncEnabled: true,
    });
    await fake.services.cloud.status.save(status);
    expect(await c.findByText('Cloud Intern at Acme')).toBeInTheDocument();
    await userEvent.click(c.getByRole('button', { name: 'Use the cloud copy' }));
    expect(fake.services.cloud.sync).toHaveBeenCalledWith({
      type: 'sync/resolve',
      kind: 'application',
      id: 'rec-1',
      choice: 'cloud',
    });
  });

  it('asks before deletions and after a cloud reset', async () => {
    const fake = renderSettings();
    const c = await connectAndSignIn();
    await fake.services.cloud.settings.save({
      connection: LOCAL_TEST_CONNECTION,
      syncEnabled: true,
    });
    await fake.services.cloud.status.save({
      ...OFF_STATUS,
      state: 'needs-confirmation',
      pendingDeletions: 7,
    });
    expect(await c.findByText(/delete 7 records in this browser/)).toBeInTheDocument();
    await userEvent.click(c.getByRole('button', { name: 'Yes, delete and sync' }));
    expect(fake.services.cloud.sync).toHaveBeenCalledWith({
      type: 'sync/run',
      allowDeletions: true,
    });

    await fake.services.cloud.status.save({ ...OFF_STATUS, state: 'cloud-reset' });
    await userEvent.click(
      await c.findByRole('button', { name: /Upload this browser's data again/ }),
    );
    expect(fake.services.cloud.sync).toHaveBeenCalledWith({ type: 'sync/restart' });
  });

  it('exports cloud data', async () => {
    const exportAll = vi.fn(() =>
      Promise.resolve({
        format: 'applypilot-cloud-export' as const,
        exportedAt: '2026-10-20T12:00:00.000Z',
        account: { userId: 'user-1' },
        items: [],
      }),
    );
    renderSettings({ cloud: { account: { exportAll: exportAll as never } } });
    const c = await connectAndSignIn();
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    await userEvent.click(c.getByRole('button', { name: /Export cloud data/ }));
    expect(await c.findByText('Cloud export downloaded.')).toBeInTheDocument();
    expect(exportAll).toHaveBeenCalled();
  });

  it('deletes cloud data only after confirmation and keeps local data', async () => {
    const fake = renderSettings();
    await fake.services.localStore.set(STORAGE_KEYS.applications, []);
    const c = await connectAndSignIn();
    await userEvent.click(c.getByRole('button', { name: /Delete cloud data/ }));
    expect(fake.account.deleteData).not.toHaveBeenCalled();
    await userEvent.click(c.getByRole('button', { name: 'Yes, delete cloud data' }));
    expect(await c.findByText(/Your cloud data was deleted and sync is off/)).toBeInTheDocument();
    expect(fake.account.deleteData).toHaveBeenCalledTimes(1);
    expect(fake.services.cloud.sync).toHaveBeenCalledWith({ type: 'sync/reset' });
    expect(await fake.services.localStore.get(STORAGE_KEYS.applications)).toEqual([]);
  });

  it('deletes the account, signs out and keeps local data', async () => {
    const fake = renderSettings();
    const c = await connectAndSignIn();
    await userEvent.click(c.getByRole('button', { name: /Delete account/ }));
    await userEvent.click(c.getByRole('button', { name: 'Yes, delete my account' }));
    expect(await c.findByText(/account and its data were deleted/)).toBeInTheDocument();
    expect(fake.account.deleteAccount).toHaveBeenCalledTimes(1);
    expect(await fake.services.cloud.auth.session()).toBeNull();
    expect(c.getByRole('button', { name: /Sign in or create account/ })).toBeInTheDocument();
  });

  it('signs out', async () => {
    const fake = renderSettings();
    const c = await connectAndSignIn();
    await userEvent.click(c.getByRole('button', { name: /Sign out/ }));
    expect(await c.findByRole('button', { name: /Sign in or create account/ })).toBeInTheDocument();
    expect(await fake.services.cloud.auth.session()).toBeNull();
  });
});
