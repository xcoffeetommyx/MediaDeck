import type {
  AdministratorSettings,
  AdministratorStatus,
  BackupListResponse,
  BackupSummary,
  AddonWatchScanResponse,
  BrowserResourceReport,
  BrowserWorkerHealthResponse,
  OperationalDiagnostics,
  OperationEventListResponse,
  Profile,
  ProfileAddon,
  ProfileAddonListResponse,
  RestoreBackupResponse,
  StreamQualityPreset,
  UnlockAdministratorResponse,
  UpdateStatus,
} from '@mediadeck/contracts';
import {
  type ChangeEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  ApiError,
  clearAdministratorToken,
  requestJson,
  setAdministratorToken,
} from './api';
import { ConfirmDialog, type ConfirmRequest } from './Modal';

type Tone = 'bad' | 'good' | 'neutral' | 'pending' | 'warn';

const streamQualityOptions: {
  description: string;
  id: StreamQualityPreset;
  label: string;
  rate: string;
}[] = [
  {
    description: 'Lowest bandwidth and CPU load.',
    id: 'data-saver',
    label: 'Data saver',
    rate: '30 FPS · 3 Mbps',
  },
  {
    description: 'Recommended for most video.',
    id: 'balanced',
    label: 'Balanced',
    rate: '30 FPS · 6 Mbps',
  },
  {
    description: 'Smoother motion at the same bitrate.',
    id: 'smooth',
    label: 'Smooth',
    rate: '60 FPS · 6 Mbps',
  },
  {
    description: 'Highest motion quality and host load.',
    id: 'high-quality',
    label: 'High quality',
    rate: '60 FPS · 12 Mbps',
  },
];

type SettingsViewProperties = {
  controllerConnected: boolean;
  onBack: () => void;
  profile: Profile | null;
  workerHealth: BrowserWorkerHealthResponse | null;
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = units[0]!;
  for (let index = 1; value >= 1024 && index < units.length; index += 1) {
    value /= 1024;
    unit = units[index]!;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${unit}`;
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function authorized(status: AdministratorStatus | null): boolean {
  return Boolean(status?.authenticated);
}

export function SettingsView({
  controllerConnected,
  onBack,
  profile,
  workerHealth,
}: SettingsViewProperties) {
  const [administrator, setAdministrator] = useState<AdministratorStatus | null>(null);
  const [settings, setSettings] = useState<AdministratorSettings | null>(null);
  const [diagnostics, setDiagnostics] = useState<OperationalDiagnostics | null>(null);
  const [backups, setBackups] = useState<BackupSummary[]>([]);
  const [events, setEvents] = useState<OperationEventListResponse['events']>([]);
  const [resources, setResources] = useState<BrowserResourceReport | null>(null);
  const [addons, setAddons] = useState<ProfileAddon[]>([]);
  const [newPin, setNewPin] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  const addonFileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const [nextAdministrator, nextSettings, nextDiagnostics, nextBackups, nextAddons] =
      await Promise.all([
        requestJson<AdministratorStatus>('/api/v1/admin/status'),
        requestJson<AdministratorSettings>('/api/v1/settings'),
        requestJson<OperationalDiagnostics>('/api/v1/operations/diagnostics'),
        requestJson<BackupListResponse>('/api/v1/backups'),
        profile
          ? requestJson<ProfileAddonListResponse>(
              `/api/v1/profiles/${profile.id}/addons`,
            )
          : Promise.resolve({ addons: [] }),
      ]);
    setAdministrator(nextAdministrator);
    setSettings(nextSettings);
    setDiagnostics(nextDiagnostics);
    setBackups(nextBackups.backups);
    setAddons(nextAddons.addons);
    if (nextAdministrator.authenticated) {
      const [log, resourceReport] = await Promise.all([
        requestJson<OperationEventListResponse>('/api/v1/operations/logs?limit=8'),
        requestJson<BrowserResourceReport>('/api/v1/operations/resources'),
      ]);
      setEvents(log.events);
      setResources(resourceReport);
    } else {
      setEvents([]);
      setResources(null);
    }
    setLoaded(true);
  }, [profile]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch((loadError: unknown) => {
        setError(errorMessage(loadError, 'Operations could not be loaded.'));
        setLoaded(true);
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const run = useCallback(
    async (name: string, action: () => Promise<string>) => {
      setBusy(name);
      setError(null);
      setNotice(null);
      try {
        setNotice(await action());
        await load();
      } catch (actionError) {
        if (actionError instanceof ApiError && actionError.statusCode === 401) {
          clearAdministratorToken();
        }
        setError(errorMessage(actionError, 'The operation could not be completed.'));
        try {
          await load();
        } catch {
          // The action error is more useful than a follow-up refresh error.
        }
      } finally {
        setBusy(null);
      }
    },
    [load],
  );

  const pinProtected = Boolean(administrator?.pinEnabled);
  const controlsLocked = pinProtected && !authorized(administrator);
  const activeSessions =
    resources?.capacity.activeSessions ?? diagnostics?.activeSessions ?? 0;
  const selectedQuality = streamQualityOptions.find(
    (option) => option.id === settings?.streamQualityPreset,
  );

  // Confirmations run the same `run` pipeline as direct actions; the dialog
  // only decides whether the request is made.
  const confirmThen = useCallback(
    (request: Omit<ConfirmRequest, 'onConfirm'>, action: () => void) => {
      setConfirmRequest({
        ...request,
        onConfirm: () => {
          setConfirmRequest(null);
          action();
        },
      });
    },
    [],
  );

  const installAddon = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file || !profile) return;
      await run('addon-install', async () => {
        const addon = await requestJson<ProfileAddon>(
          `/api/v1/profiles/${profile.id}/addons`,
          {
            body: await file.arrayBuffer(),
            headers: {
              'Content-Type': 'application/x-xpinstall',
              'X-MediaDeck-Filename': file.name,
            },
            method: 'POST',
          },
        );
        return `${addon.name} ${addon.version} is ready for ${profile.name}.`;
      });
    },
    [profile, run],
  );

  return (
    <DetailView
      description="Administration, backups, diagnostics, and recovery in one place."
      eyebrow="Operations"
      onBack={onBack}
      title="Settings"
    >
      {error ? (
        <div className="operation-notice error" role="alert">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="operation-notice" role="status">
          {notice}
        </div>
      ) : null}

      <div className="detail-grid">
        <StatusCard
          detail={
            controllerConnected
              ? 'D-pad, A, and B are active.'
              : 'Press any button on a connected controller.'
          }
          label="Controller"
          tone={controllerConnected ? 'good' : 'neutral'}
          value={controllerConnected ? 'Connected' : 'Ready to connect'}
        />
        <StatusCard
          detail={
            workerHealth
              ? `Transport: ${workerHealth.transport.provider} over ${workerHealth.transport.mode}.`
              : 'No browser worker is configured for this host.'
          }
          label="Firefox worker"
          tone={
            workerHealth?.status === 'online'
              ? 'good'
              : workerHealth?.status === 'offline'
                ? 'warn'
                : 'neutral'
          }
          value={
            workerHealth?.status === 'online'
              ? 'Online'
              : workerHealth?.status === 'offline'
                ? 'Offline'
                : 'Not configured'
          }
        />
        <StatusCard
          detail={
            diagnostics
              ? `${diagnostics.profiles} profiles · ${diagnostics.activeSessions} active · ${formatBytes(diagnostics.storage.availableBytes)} free`
              : 'Reading storage and service health.'
          }
          label="System health"
          tone={
            diagnostics?.status === 'healthy'
              ? 'good'
              : diagnostics
                ? 'warn'
                : 'pending'
          }
          value={
            diagnostics?.status === 'healthy'
              ? 'Healthy'
              : diagnostics
                ? 'Needs attention'
                : 'Checking'
          }
        />
        <StatusCard
          detail={
            diagnostics
              ? `Schema ${diagnostics.database.schemaVersion} · ${formatBytes(diagnostics.database.sizeBytes)}`
              : 'Database diagnostics are loading.'
          }
          label="Database"
          tone={
            diagnostics?.database.healthy ? 'good' : diagnostics ? 'bad' : 'pending'
          }
          value={diagnostics?.database.healthy ? 'Healthy' : 'Checking'}
        />
        <StatusCard
          detail={
            resources
              ? `${resources.capacity.activeSessions} of ${resources.capacity.maxSessions} active · ${resources.capacity.availableSlots} available`
              : loaded
                ? 'Unlock administrator controls to inspect stream capacity.'
                : 'Reading stream capacity.'
          }
          label="Stream capacity"
          tone={
            !resources
              ? loaded
                ? 'neutral'
                : 'pending'
              : resources.capacity.atCapacity
                ? 'warn'
                : 'good'
          }
          value={
            !resources
              ? loaded
                ? 'Locked'
                : 'Checking'
              : resources.capacity.atCapacity
                ? 'Full'
                : 'Available'
          }
        />
      </div>

      <div className="operations-grid">
        <OperationCard
          action={
            <div className="row-actions">
              {/* The picker is opened by the button beside it, so it stays out
                  of the tab and directional-focus order. */}
              <input
                accept=".xpi,application/x-xpinstall"
                aria-hidden="true"
                aria-label="Choose Firefox add-on package"
                className="visually-hidden"
                onChange={(event) => void installAddon(event)}
                ref={addonFileInput}
                tabIndex={-1}
                type="file"
              />
              <button
                aria-busy={busy === 'addon-install'}
                className="primary-button focusable"
                data-focusable="true"
                disabled={busy !== null || controlsLocked || !profile}
                onClick={() => addonFileInput.current?.click()}
              >
                {busy === 'addon-install' ? 'Checking package…' : 'Install XPI'}
              </button>
              <button
                aria-busy={busy === 'addon-scan'}
                className="secondary-button focusable"
                data-focusable="true"
                disabled={busy !== null || controlsLocked}
                onClick={() =>
                  void run('addon-scan', async () => {
                    const result = await requestJson<AddonWatchScanResponse>(
                      '/api/v1/addons/watch/scan',
                      {
                        headers: { 'Content-Type': 'application/json' },
                        method: 'POST',
                        body: '{}',
                      },
                    );
                    return `Watched folder: ${result.imported} imported, ${result.rejected} rejected, ${result.skipped} skipped.`;
                  })
                }
              >
                Scan folder
              </button>
            </div>
          }
          eyebrow="Firefox"
          title={profile ? `${profile.name} add-ons` : 'Guest add-ons'}
          wide
        >
          {!profile ? (
            <p className="operation-empty">
              <strong>Guest sessions do not keep add-ons.</strong>
              Guest storage is erased on return, so managed extensions belong to a
              persistent profile.
            </p>
          ) : !loaded ? (
            <SkeletonRows rows={2} />
          ) : addons.length === 0 ? (
            <p className="operation-empty">
              <strong>No managed add-ons yet.</strong>
              Install a Mozilla-signed XPI that declares an explicit Firefox extension
              ID.
            </p>
          ) : (
            <div className="backup-list">
              {addons.map((addon) => (
                <div className="backup-row addon-row" key={addon.id}>
                  <div>
                    <strong>
                      {addon.name} <span>v{addon.version}</span>
                    </strong>
                    <span>
                      {addon.enabled ? 'Enabled' : 'Disabled'} ·{' '}
                      {addon.permissions.length} declared permissions · {addon.source}
                    </span>
                    <code>{addon.id}</code>
                  </div>
                  <div className="row-actions">
                    <button
                      aria-pressed={addon.enabled}
                      className="secondary-button focusable"
                      data-focusable="true"
                      disabled={busy !== null || controlsLocked}
                      onClick={() =>
                        void run(`addon-${addon.id}`, async () => {
                          await requestJson(
                            `/api/v1/profiles/${profile.id}/addons/${encodeURIComponent(addon.id)}`,
                            {
                              body: JSON.stringify({
                                enabled: !addon.enabled,
                              }),
                              headers: { 'Content-Type': 'application/json' },
                              method: 'PATCH',
                            },
                          );
                          return `${addon.name} ${addon.enabled ? 'disabled' : 'enabled'}.`;
                        })
                      }
                    >
                      {addon.enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button
                      aria-label={`Remove ${addon.name}`}
                      className="secondary-button danger-button focusable"
                      data-focusable="true"
                      disabled={busy !== null || controlsLocked}
                      onClick={() =>
                        confirmThen(
                          {
                            body: `${addon.name} ${addon.version} will be removed from ${profile.name} only. Other profiles keep their own copy. The change applies the next time Firefox launches.`,
                            confirmLabel: 'Remove add-on',
                            danger: true,
                            eyebrow: 'Firefox add-ons',
                            title: `Remove ${addon.name}?`,
                          },
                          () =>
                            void run(`addon-remove-${addon.id}`, async () => {
                              await requestJson(
                                `/api/v1/profiles/${profile.id}/addons/${encodeURIComponent(addon.id)}`,
                                { method: 'DELETE' },
                              );
                              return `${addon.name} removed.`;
                            }),
                        )
                      }
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="operation-help">
            Add-on changes apply on the next Firefox launch. Install a newer package
            with the same ID to update it. Stop this profile’s active stream before
            making changes.
          </p>
        </OperationCard>

        <OperationCard
          badge={
            resources
              ? `${resources.limitsPerWorker.cpus} CPU · ${formatBytes(resources.limitsPerWorker.memoryBytes)} each`
              : 'Administrator'
          }
          eyebrow="Concurrency"
          title="Active stream resources"
          wide
        >
          {!loaded ? (
            <SkeletonRows rows={2} />
          ) : !resources ? (
            <p className="operation-empty">
              <strong>Locked.</strong>
              Unlock administrator controls to view per-session resource usage.
            </p>
          ) : resources.sessions.length === 0 ? (
            <p className="operation-empty">
              <strong>No streams are active.</strong>
              Limits are reserved and ready for the next Firefox worker.
            </p>
          ) : (
            resources.sessions.map((sample, index) => (
              <SettingRow
                action={
                  <span className="stage-badge">
                    {sample.gpu.mode === 'dri' ? 'GPU encode' : 'Software encode'}
                  </span>
                }
                detail={`${sample.cpuPercent === null ? 'CPU sampling' : `${sample.cpuPercent.toFixed(1)}% CPU`} · ${formatBytes(sample.memoryBytes)} memory · ${formatBytes(sample.networkReceiveBytes)} down / ${formatBytes(sample.networkTransmitBytes)} up · ${sample.pids} processes`}
                key={sample.sessionId}
                title={`Stream ${index + 1} · ${sample.status}`}
              />
            ))
          )}
          {resources ? (
            <p className="operation-help">
              Each worker is capped at {resources.limitsPerWorker.cpus} CPU,{' '}
              {formatBytes(resources.limitsPerWorker.memoryBytes)} memory,{' '}
              {resources.limitsPerWorker.pids} processes, and{' '}
              {resources.limitsPerWorker.videoBitrateMbps} Mbps encoded video.
            </p>
          ) : null}
        </OperationCard>

        <OperationCard
          badge={pinProtected ? 'PIN protected' : 'Tailnet only'}
          badgeTone={pinProtected ? 'good' : 'neutral'}
          eyebrow="Security"
          title="Administrator access"
        >
          {controlsLocked ? (
            <AdministratorUnlock
              busy={busy === 'unlock'}
              onUnlock={(pin) =>
                run('unlock', async () => {
                  const response = await requestJson<UnlockAdministratorResponse>(
                    '/api/v1/admin/unlock',
                    {
                      body: JSON.stringify({ pin }),
                      headers: { 'Content-Type': 'application/json' },
                      method: 'POST',
                    },
                  );
                  setAdministratorToken(response.token);
                  return 'Administrator controls unlocked for 15 minutes.';
                })
              }
            />
          ) : (
            <div className="operation-controls">
              <label className="field-label" htmlFor="administrator-pin">
                {pinProtected ? 'New PIN' : 'Create a PIN'}
              </label>
              <input
                className="text-field focusable compact-field"
                data-focusable="true"
                id="administrator-pin"
                inputMode="numeric"
                maxLength={12}
                onChange={(event) =>
                  setNewPin(event.target.value.replaceAll(/\D/g, ''))
                }
                placeholder="4–12 digits"
                type="password"
                value={newPin}
              />
              <button
                aria-busy={busy === 'pin'}
                className="primary-button focusable"
                data-focusable="true"
                disabled={busy !== null || newPin.length < 4}
                onClick={() =>
                  void run('pin', async () => {
                    await requestJson('/api/v1/admin/pin', {
                      body: JSON.stringify({ pin: newPin }),
                      headers: { 'Content-Type': 'application/json' },
                      method: 'PUT',
                    });
                    clearAdministratorToken();
                    setNewPin('');
                    return pinProtected
                      ? 'PIN changed. Unlock with the new PIN.'
                      : 'PIN protection enabled.';
                  })
                }
              >
                {pinProtected ? 'Change PIN' : 'Enable PIN'}
              </button>
              {pinProtected ? (
                <>
                  <button
                    className="secondary-button focusable"
                    data-focusable="true"
                    disabled={busy !== null}
                    onClick={() =>
                      void run('disable-pin', async () => {
                        await requestJson('/api/v1/admin/pin', {
                          body: JSON.stringify({ pin: null }),
                          headers: { 'Content-Type': 'application/json' },
                          method: 'PUT',
                        });
                        clearAdministratorToken();
                        return 'PIN protection disabled.';
                      })
                    }
                  >
                    Disable PIN
                  </button>
                  <button
                    className="secondary-button focusable"
                    data-focusable="true"
                    disabled={busy !== null}
                    onClick={() =>
                      void run('lock', async () => {
                        await requestJson('/api/v1/admin/lock', {
                          method: 'POST',
                        });
                        clearAdministratorToken();
                        return 'Administrator controls locked.';
                      })
                    }
                  >
                    Lock now
                  </button>
                </>
              ) : null}
            </div>
          )}
          <p className="operation-help">
            When enabled, privileged settings, profile deletion, backup changes,
            restores, and updates require the PIN.
          </p>
        </OperationCard>

        <OperationCard
          badge={selectedQuality?.label ?? 'Balanced'}
          eyebrow="Streaming"
          title="Stream quality"
          wide
        >
          <div className="quality-preset-grid">
            {streamQualityOptions.map((option) => (
              <button
                aria-pressed={settings?.streamQualityPreset === option.id}
                className="quality-preset focusable"
                data-focusable="true"
                disabled={
                  busy !== null || !settings || controlsLocked || activeSessions > 0
                }
                key={option.id}
                onClick={() =>
                  void run('stream-quality', async () => {
                    await requestJson('/api/v1/settings', {
                      body: JSON.stringify({ streamQualityPreset: option.id }),
                      headers: { 'Content-Type': 'application/json' },
                      method: 'PATCH',
                    });
                    return `${option.label} stream quality saved. New Firefox sessions will use it.`;
                  })
                }
              >
                <strong>{option.label}</strong>
                <span>{option.rate}</span>
                <small>{option.description}</small>
              </button>
            ))}
          </div>
          <p className="operation-help">
            {activeSessions > 0
              ? 'Stop the active Firefox session before changing quality.'
              : 'MediaDeck uses hardware video acceleration automatically when a compatible DRI device is available, and falls back to software safely.'}
          </p>
        </OperationCard>

        <OperationCard eyebrow="Preferences" title="Maintenance policy">
          <SettingRow
            action={
              <button
                aria-pressed={settings?.automaticUpdateChecks ?? false}
                className="secondary-button focusable"
                data-focusable="true"
                disabled={busy !== null || !settings || controlsLocked}
                onClick={() =>
                  settings &&
                  void run('settings', async () => {
                    await requestJson('/api/v1/settings', {
                      body: JSON.stringify({
                        automaticUpdateChecks: !settings.automaticUpdateChecks,
                      }),
                      headers: { 'Content-Type': 'application/json' },
                      method: 'PATCH',
                    });
                    return 'Update-check preference saved.';
                  })
                }
              >
                {settings?.automaticUpdateChecks ? 'On' : 'Off'}
              </button>
            }
            detail="Check the configured HTTPS manifest every six hours."
            title="Automatic update checks"
          />
          <SettingRow
            action={
              <div className="stepper">
                <button
                  aria-label="Keep one fewer backup"
                  className="secondary-button focusable"
                  data-focusable="true"
                  disabled={
                    busy !== null ||
                    !settings ||
                    settings.backupRetentionCount <= 1 ||
                    controlsLocked
                  }
                  onClick={() =>
                    settings &&
                    void updateRetention(settings.backupRetentionCount - 1, run)
                  }
                >
                  −
                </button>
                <strong>{settings?.backupRetentionCount ?? '–'}</strong>
                <button
                  aria-label="Keep one more backup"
                  className="secondary-button focusable"
                  data-focusable="true"
                  disabled={
                    busy !== null ||
                    !settings ||
                    settings.backupRetentionCount >= 20 ||
                    controlsLocked
                  }
                  onClick={() =>
                    settings &&
                    void updateRetention(settings.backupRetentionCount + 1, run)
                  }
                >
                  +
                </button>
              </div>
            }
            detail="Keep the newest verified backups."
            title="Backup retention"
          />
        </OperationCard>

        <OperationCard
          action={
            <button
              aria-busy={busy === 'backup'}
              className="primary-button focusable"
              data-focusable="true"
              disabled={busy !== null || controlsLocked}
              onClick={() =>
                void run('backup', async () => {
                  const backup = await requestJson<BackupSummary>('/api/v1/backups', {
                    method: 'POST',
                  });
                  return `Backup ${backup.id} created.`;
                })
              }
            >
              {busy === 'backup' ? 'Backing up…' : 'Create backup'}
            </button>
          }
          eyebrow="Recovery"
          title="Backups"
          wide
        >
          {!loaded ? (
            <SkeletonRows rows={2} />
          ) : backups.length === 0 ? (
            <p className="operation-empty">
              <strong>No backups yet.</strong>
              Create one before an update or a risky change; MediaDeck keeps the newest{' '}
              {settings?.backupRetentionCount ?? 5}.
            </p>
          ) : (
            <div className="backup-list">
              {backups.slice(0, 5).map((backup) => (
                <div className="backup-row" key={backup.id}>
                  <div>
                    <strong>{formatDateTime(backup.createdAt)}</strong>
                    <span>
                      {backup.profileCount} profiles · {formatBytes(backup.sizeBytes)} ·
                      schema {backup.schemaVersion}
                    </span>
                  </div>
                  <div className="row-actions">
                    <button
                      aria-label={`Restore the backup from ${formatDateTime(backup.createdAt)}`}
                      className="secondary-button focusable"
                      data-focusable="true"
                      disabled={busy !== null || controlsLocked}
                      onClick={() =>
                        confirmThen(
                          {
                            body: `The backup from ${formatDateTime(backup.createdAt)} replaces the current database and all ${backup.profileCount} profiles the next time the app container restarts. Nothing changes until then.`,
                            confirmLabel: 'Schedule restore',
                            eyebrow: 'Recovery',
                            title: 'Restore this backup?',
                          },
                          () =>
                            void run('restore', async () => {
                              const response = await requestJson<RestoreBackupResponse>(
                                `/api/v1/backups/${backup.id}/restore`,
                                { method: 'POST' },
                              );
                              return response.restartRequired
                                ? 'Restore scheduled. Restart the app container to apply it.'
                                : 'Restore scheduled.';
                            }),
                        )
                      }
                    >
                      Restore
                    </button>
                    <button
                      aria-label={`Delete the backup from ${formatDateTime(backup.createdAt)}`}
                      className="secondary-button danger-button focusable"
                      data-focusable="true"
                      disabled={busy !== null || controlsLocked}
                      onClick={() =>
                        confirmThen(
                          {
                            body: `The backup from ${formatDateTime(backup.createdAt)} will be permanently deleted. This cannot be undone.`,
                            confirmLabel: 'Delete backup',
                            danger: true,
                            eyebrow: 'Recovery',
                            title: 'Delete this backup?',
                          },
                          () =>
                            void run('delete-backup', async () => {
                              await requestJson(`/api/v1/backups/${backup.id}`, {
                                method: 'DELETE',
                              });
                              return 'Backup deleted.';
                            }),
                        )
                      }
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </OperationCard>

        <OperationCard
          action={
            <button
              aria-busy={busy === 'reconcile'}
              className="secondary-button focusable"
              data-focusable="true"
              disabled={busy !== null || controlsLocked}
              onClick={() =>
                void run('reconcile', async () => {
                  await requestJson('/api/v1/operations/reconcile', {
                    method: 'POST',
                  });
                  return 'Session reconciliation completed.';
                })
              }
            >
              {busy === 'reconcile' ? 'Checking…' : 'Run recovery check'}
            </button>
          }
          eyebrow="Diagnostics"
          title="Recent operations"
          wide
        >
          {controlsLocked ? (
            <p className="operation-empty">
              <strong>Locked.</strong>
              Unlock administrator controls to read the operations log.
            </p>
          ) : !loaded ? (
            <SkeletonRows rows={3} />
          ) : events.length === 0 ? (
            <p className="operation-empty">
              <strong>No recorded operations yet.</strong>
              Backups, profile changes, and recovery checks are listed here as they
              happen.
            </p>
          ) : (
            <ol className="event-list">
              {events.map((event) => (
                <li className={`event-${event.level}`} key={event.id}>
                  <span>{event.category}</span>
                  <strong>{event.message}</strong>
                  <time dateTime={event.createdAt}>
                    {formatDateTime(event.createdAt)}
                  </time>
                </li>
              ))}
            </ol>
          )}
        </OperationCard>
      </div>

      {confirmRequest ? (
        <ConfirmDialog
          busy={busy !== null}
          onCancel={() => setConfirmRequest(null)}
          request={confirmRequest}
        />
      ) : null}
    </DetailView>
  );
}

async function updateRetention(
  count: number,
  run: (name: string, action: () => Promise<string>) => Promise<void>,
): Promise<void> {
  await run('settings', async () => {
    await requestJson('/api/v1/settings', {
      body: JSON.stringify({ backupRetentionCount: count }),
      headers: { 'Content-Type': 'application/json' },
      method: 'PATCH',
    });
    return 'Backup retention saved.';
  });
}

export function UpdatesView({
  onBack,
  version,
}: {
  onBack: () => void;
  version: string;
}) {
  const [administrator, setAdministrator] = useState<AdministratorStatus | null>(null);
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);

  const load = useCallback(async () => {
    const [nextAdministrator, nextStatus] = await Promise.all([
      requestJson<AdministratorStatus>('/api/v1/admin/status'),
      requestJson<UpdateStatus>('/api/v1/updates/status'),
    ]);
    setAdministrator(nextAdministrator);
    setStatus(nextStatus);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch((loadError: unknown) => {
        setError(errorMessage(loadError, 'Update status could not be loaded.'));
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const runUpdate = async (action: () => Promise<UpdateStatus>) => {
    setBusy(true);
    setError(null);
    try {
      setStatus(await action());
    } catch (actionError) {
      if (actionError instanceof ApiError && actionError.statusCode === 401) {
        clearAdministratorToken();
      }
      setError(errorMessage(actionError, 'The update action failed.'));
      try {
        await load();
      } catch {
        // Keep the original action error.
      }
    } finally {
      setBusy(false);
    }
  };

  const stateLabel =
    status?.state === 'available'
      ? 'Update available'
      : status?.state === 'approved'
        ? 'Approved'
        : status?.state === 'error'
          ? 'Check failed'
          : status?.state === 'unconfigured'
            ? 'Manifest needed'
            : 'Current';

  const stateTone: Tone =
    status?.state === 'available' || status?.state === 'approved'
      ? 'warn'
      : status?.state === 'error'
        ? 'bad'
        : status?.state === 'unconfigured'
          ? 'neutral'
          : status
            ? 'good'
            : 'pending';

  const unconfigured = status?.state === 'unconfigured';
  const availableRelease = status?.state === 'available' ? status.release : null;

  return (
    <DetailView
      description="Checks are automatic; installation always waits for approval."
      eyebrow="System"
      onBack={onBack}
      title="Updates"
    >
      {error ? (
        <div className="operation-notice error" role="alert">
          {error}
        </div>
      ) : null}
      <div className="update-panel">
        <div className="update-orbit" aria-hidden="true">
          <span>↑</span>
        </div>
        <div>
          <span className="update-label">Installed version</span>
          <strong>MediaDeck {version}</strong>
          <p>
            {unconfigured
              ? 'No release manifest is configured, so MediaDeck is not checking for updates. An operator can point the host at an HTTPS manifest to enable checks.'
              : (status?.message ?? 'Reading update status…')}
          </p>
          {status?.checkedAt ? (
            <small>Last checked {formatDateTime(status.checkedAt)}</small>
          ) : null}
        </div>
        <span className={`stage-badge ${stateTone}`}>{stateLabel}</span>
      </div>

      <OperationCard eyebrow="Release controls" title="Update workflow" wide>
        {administrator?.pinEnabled && !administrator.authenticated ? (
          <AdministratorUnlock
            busy={busy}
            onUnlock={async (pin) => {
              setBusy(true);
              setError(null);
              try {
                const response = await requestJson<UnlockAdministratorResponse>(
                  '/api/v1/admin/unlock',
                  {
                    body: JSON.stringify({ pin }),
                    headers: { 'Content-Type': 'application/json' },
                    method: 'POST',
                  },
                );
                setAdministratorToken(response.token);
                await load();
              } catch (unlockError) {
                setError(errorMessage(unlockError, 'The PIN was not accepted.'));
              } finally {
                setBusy(false);
              }
            }}
          />
        ) : (
          <div className="operation-controls">
            <button
              aria-busy={busy}
              aria-describedby={unconfigured ? 'update-manifest-note' : undefined}
              className="secondary-button focusable"
              data-focusable="true"
              disabled={busy || !status?.manifestConfigured}
              onClick={() =>
                void runUpdate(() =>
                  requestJson<UpdateStatus>('/api/v1/updates/check', {
                    method: 'POST',
                  }),
                )
              }
            >
              {busy ? 'Working…' : 'Check now'}
            </button>
            {availableRelease ? (
              <button
                className="primary-button focusable"
                data-focusable="true"
                disabled={busy}
                onClick={() =>
                  setConfirmRequest({
                    body: `MediaDeck ${availableRelease.version} will be recorded as approved and a fresh backup will be created first. The digest-pinned image is applied later from the host runbook — nothing restarts now.`,
                    confirmLabel: 'Approve and back up',
                    eyebrow: 'Release controls',
                    onConfirm: () => {
                      setConfirmRequest(null);
                      void runUpdate(() =>
                        requestJson<UpdateStatus>('/api/v1/updates/approve', {
                          body: JSON.stringify({
                            version: availableRelease.version,
                          }),
                          headers: { 'Content-Type': 'application/json' },
                          method: 'POST',
                        }),
                      );
                    },
                    title: `Approve MediaDeck ${availableRelease.version}?`,
                  })
                }
              >
                Approve and back up
              </button>
            ) : null}
          </div>
        )}

        {unconfigured ? (
          <p className="operation-help" id="update-manifest-note">
            Release checks stay off until the host sets an HTTPS update manifest. See
            the deployment runbook for <code>MEDIADECK_UPDATE_MANIFEST_URL</code>.
          </p>
        ) : null}

        {status?.release ? (
          <div className="release-detail">
            <strong>MediaDeck {status.release.version}</strong>
            <span>Published {formatDateTime(status.release.publishedAt)}</span>
            <code>{status.release.image}</code>
            {status.release.releaseNotesUrl ? (
              <a
                className="secondary-button focusable"
                data-focusable="true"
                href={status.release.releaseNotesUrl}
                rel="noreferrer"
                target="_blank"
              >
                Release notes
              </a>
            ) : null}
          </div>
        ) : null}
        {status?.state === 'approved' ? (
          <p className="operation-help">
            Approval is recorded with backup <code>{status.backupId}</code>. Apply the
            digest-pinned image with the host runbook; the web app cannot silently
            replace its own container.
          </p>
        ) : null}
      </OperationCard>

      {confirmRequest ? (
        <ConfirmDialog
          busy={busy}
          onCancel={() => setConfirmRequest(null)}
          request={confirmRequest}
        />
      ) : null}
    </DetailView>
  );
}

function AdministratorUnlock({
  busy,
  onUnlock,
}: {
  busy: boolean;
  onUnlock: (pin: string) => void | Promise<void>;
}) {
  const [pin, setPin] = useState('');
  return (
    <form
      className="unlock-form"
      onSubmit={(event) => {
        event.preventDefault();
        void onUnlock(pin);
      }}
    >
      <label className="field-label" htmlFor="unlock-pin">
        Administrator PIN
      </label>
      <input
        autoComplete="current-password"
        className="text-field focusable compact-field"
        data-focusable="true"
        id="unlock-pin"
        inputMode="numeric"
        maxLength={12}
        onChange={(event) => setPin(event.target.value.replaceAll(/\D/g, ''))}
        placeholder="Enter PIN"
        type="password"
        value={pin}
      />
      <button
        aria-busy={busy}
        className="primary-button focusable"
        data-focusable="true"
        disabled={busy || pin.length < 4}
        type="submit"
      >
        {busy ? 'Unlocking…' : 'Unlock'}
      </button>
    </form>
  );
}

function DetailView({
  children,
  description,
  eyebrow,
  onBack,
  title,
}: {
  children: ReactNode;
  description: string;
  eyebrow: string;
  onBack: () => void;
  title: string;
}) {
  return (
    <section className="detail-view" aria-labelledby="operations-detail-heading">
      <button
        className="back-button focusable"
        data-autofocus="true"
        data-focusable="true"
        onClick={onBack}
      >
        <span aria-hidden="true">←</span> Back
      </button>
      <div className="section-heading">
        <p className="eyebrow">{eyebrow}</p>
        <h1 id="operations-detail-heading">{title}</h1>
        <p>{description}</p>
      </div>
      {children}
    </section>
  );
}

function StatusCard({
  detail,
  label,
  tone,
  value,
}: {
  detail: string;
  label: string;
  tone: Tone;
  value: string;
}) {
  return (
    <article className={`status-card ${tone}`}>
      <span className="status-card-label">{label}</span>
      <i className={`status-card-light ${tone}`} aria-hidden="true" />
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

function OperationCard({
  action,
  badge,
  badgeTone = 'neutral',
  children,
  eyebrow,
  title,
  wide = false,
}: {
  action?: ReactNode;
  badge?: string;
  badgeTone?: Tone;
  children: ReactNode;
  eyebrow: string;
  title: string;
  wide?: boolean;
}) {
  return (
    <section className={`operation-card ${wide ? 'operation-card-wide' : ''}`}>
      <div className="operation-card-heading">
        <div>
          <span className="update-label">{eyebrow}</span>
          <h2>{title}</h2>
        </div>
        {badge ? <span className={`stage-badge ${badgeTone}`}>{badge}</span> : action}
      </div>
      {children}
    </section>
  );
}

function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <div className="skeleton-row" key={index}>
          <span className="skeleton-line" style={{ width: '45%' }} />
          <span className="skeleton-line" style={{ height: '0.55rem', width: '70%' }} />
        </div>
      ))}
    </div>
  );
}

function SettingRow({
  action,
  detail,
  title,
}: {
  action: ReactNode;
  detail: string;
  title: string;
}) {
  return (
    <div className="setting-row">
      <div>
        <strong>{title}</strong>
        <span>{detail}</span>
      </div>
      {action}
    </div>
  );
}
