import type {
  BrowserWorkerHealthResponse,
  HealthResponse,
  Profile,
  ProfileListResponse,
} from '@mediadeck/contracts';
import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { ApiError, requestJson } from './api';
import { useAutoFocus, useInputNavigation } from './navigation';

type View = 'profiles' | 'home' | 'settings' | 'updates';

type ActiveProfile = { kind: 'profile'; profile: Profile } | { kind: 'guest' };

type ConnectionState =
  | { status: 'connecting' }
  | { status: 'online'; version: string }
  | { status: 'unavailable' };

type Overlay = 'create-profile' | 'youtube' | null;

const avatarOptions = ['ember', 'violet', 'ocean', 'forest', 'sunset', 'slate'];

const statusContent: Record<
  ConnectionState['status'],
  { label: string; tone: string }
> = {
  connecting: { label: 'Connecting', tone: 'pending' },
  online: { label: 'MediaDeck online', tone: 'online' },
  unavailable: { label: 'Service unavailable', tone: 'offline' },
};

export function App() {
  const [connection, setConnection] = useState<ConnectionState>({
    status: 'connecting',
  });
  const [workerHealth, setWorkerHealth] = useState<BrowserWorkerHealthResponse | null>(
    null,
  );
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(true);
  const [profilesError, setProfilesError] = useState<string | null>(null);
  const [activeProfile, setActiveProfile] = useState<ActiveProfile | null>(null);
  const [view, setView] = useState<View>('profiles');
  const [overlay, setOverlay] = useState<Overlay>(null);

  const loadProfiles = useCallback(async (signal?: AbortSignal) => {
    if (signal?.aborted) return;
    setProfilesLoading(true);
    setProfilesError(null);

    try {
      const response = await requestJson<ProfileListResponse>(
        '/api/v1/profiles',
        signal ? { signal } : undefined,
      );
      setProfiles(response.profiles);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setProfilesError(getErrorMessage(error, 'Profiles could not be loaded.'));
    } finally {
      if (!signal?.aborted) setProfilesLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    void requestJson<HealthResponse>('/api/v1/health', {
      signal: controller.signal,
    })
      .then((health) => {
        setConnection({ status: 'online', version: health.version });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setConnection({ status: 'unavailable' });
      });

    void requestJson<BrowserWorkerHealthResponse>('/api/v1/browser-worker/health', {
      signal: controller.signal,
    })
      .then(setWorkerHealth)
      .catch(() => {
        if (!controller.signal.aborted) setWorkerHealth(null);
      });

    queueMicrotask(() => void loadProfiles(controller.signal));
    return () => controller.abort();
  }, [loadProfiles]);

  const navigate = useCallback((nextView: View) => {
    setOverlay(null);
    setView(nextView);
    window.history.replaceState({ mediadeckView: nextView }, '');
  }, []);

  const goBack = useCallback(() => {
    if (overlay) {
      setOverlay(null);
      return;
    }
    if (view === 'settings' || view === 'updates') {
      navigate('home');
      return;
    }
    if (view === 'home') navigate('profiles');
  }, [navigate, overlay, view]);

  const { controllerConnected } = useInputNavigation({ onBack: goBack });
  useAutoFocus(`${view}:${overlay ?? 'none'}:${profilesLoading ? 'loading' : 'ready'}`);

  const chooseProfile = useCallback(
    (profile: Profile) => {
      setActiveProfile({ kind: 'profile', profile });
      navigate('home');
    },
    [navigate],
  );

  const chooseGuest = useCallback(() => {
    setActiveProfile({ kind: 'guest' });
    navigate('home');
  }, [navigate]);

  const profileName =
    activeProfile?.kind === 'profile' ? activeProfile.profile.name : 'Guest';
  const currentStatus = statusContent[connection.status];

  return (
    <main className={`app-shell view-${view}`}>
      <div className="ambient ambient-one" aria-hidden="true" />
      <div className="ambient ambient-two" aria-hidden="true" />

      <header className="topbar">
        <button
          className="brand focusable"
          data-focusable="true"
          aria-label={
            view === 'profiles'
              ? 'MediaDeck profile selection'
              : 'Return to MediaDeck home'
          }
          onClick={() => navigate(view === 'profiles' ? 'profiles' : 'home')}
        >
          <span className="brand-mark" aria-hidden="true">
            <span />
          </span>
          <span className="brand-name">MediaDeck</span>
        </button>

        <div className="topbar-actions">
          {view !== 'profiles' && activeProfile ? (
            <button
              className="profile-chip focusable"
              data-focusable="true"
              onClick={() => navigate('profiles')}
              aria-label={`Switch profile. Current profile: ${profileName}`}
            >
              <Avatar
                avatarId={
                  activeProfile.kind === 'profile'
                    ? activeProfile.profile.avatarId
                    : 'guest'
                }
                name={profileName}
                small
              />
              <span>{profileName}</span>
            </button>
          ) : null}

          <div
            className={`status-pill status-${currentStatus.tone}`}
            role="status"
            aria-live="polite"
          >
            <span className="status-dot" aria-hidden="true" />
            <span>{currentStatus.label}</span>
          </div>
        </div>
      </header>

      <div className="view-frame">
        {view === 'profiles' ? (
          <ProfilePicker
            error={profilesError}
            loading={profilesLoading}
            profiles={profiles}
            onChoose={chooseProfile}
            onChooseGuest={chooseGuest}
            onCreate={() => setOverlay('create-profile')}
            onRetry={() => void loadProfiles()}
          />
        ) : null}

        {view === 'home' && activeProfile ? (
          <Home
            name={profileName}
            onOpenSettings={() => navigate('settings')}
            onOpenUpdates={() => navigate('updates')}
            onOpenYouTube={() => setOverlay('youtube')}
          />
        ) : null}

        {view === 'settings' && activeProfile ? (
          <Settings
            controllerConnected={controllerConnected}
            workerHealth={workerHealth}
            onBack={goBack}
          />
        ) : null}

        {view === 'updates' && activeProfile ? (
          <Updates
            version={connection.status === 'online' ? connection.version : '0.1.0'}
            onBack={goBack}
          />
        ) : null}
      </div>

      <footer className="input-legend" aria-label="Navigation help">
        <span>
          <kbd>←</kbd>
          <kbd>↑</kbd>
          <kbd>↓</kbd>
          <kbd>→</kbd>
          <span>Navigate</span>
        </span>
        <span>
          <kbd>A</kbd>
          <span>Select</span>
        </span>
        <span>
          <kbd>B</kbd>
          <span>Back</span>
        </span>
        <span className={controllerConnected ? 'controller-live' : ''}>
          <i aria-hidden="true" />
          {controllerConnected ? 'Controller connected' : 'Keyboard · touch · mouse'}
        </span>
      </footer>

      {overlay === 'create-profile' ? (
        <CreateProfileDialog
          onCancel={() => setOverlay(null)}
          onCreated={(profile) => {
            setProfiles((current) => [...current, profile]);
            setOverlay(null);
            chooseProfile(profile);
          }}
        />
      ) : null}

      {overlay === 'youtube' ? (
        <Modal
          label="YouTube"
          onClose={() => setOverlay(null)}
          className="youtube-modal"
        >
          <div className="modal-app-icon youtube-icon" aria-hidden="true">
            <span />
          </div>
          <p className="eyebrow">Up next · Stage 5</p>
          <h2>YouTube is ready for its launch flow.</h2>
          <p className="modal-copy">
            The profile and controller shell are in place. Stage 5 connects this tile to
            your isolated Firefox stream.
          </p>
          <button
            className="primary-button focusable"
            data-focusable="true"
            data-autofocus="true"
            onClick={() => setOverlay(null)}
          >
            Got it
          </button>
        </Modal>
      ) : null}
    </main>
  );
}

type ProfilePickerProperties = {
  error: string | null;
  loading: boolean;
  onChoose: (profile: Profile) => void;
  onChooseGuest: () => void;
  onCreate: () => void;
  onRetry: () => void;
  profiles: Profile[];
};

function ProfilePicker({
  error,
  loading,
  onChoose,
  onChooseGuest,
  onCreate,
  onRetry,
  profiles,
}: ProfilePickerProperties) {
  return (
    <section className="profile-picker" aria-labelledby="profile-heading">
      <div className="section-heading centered">
        <p className="eyebrow">Choose your space</p>
        <h1 id="profile-heading">Who’s watching?</h1>
        <p>Each profile keeps its own Firefox logins, history, and preferences.</p>
      </div>

      {error ? (
        <div className="error-banner" role="alert">
          <div>
            <strong>We couldn’t reach your profiles.</strong>
            <span>{error}</span>
          </div>
          <button
            className="secondary-button focusable"
            data-focusable="true"
            data-autofocus="true"
            onClick={onRetry}
          >
            Try again
          </button>
        </div>
      ) : null}

      <div className="profile-grid" aria-busy={loading}>
        {loading ? (
          <>
            <ProfileSkeleton />
            <ProfileSkeleton />
            <ProfileSkeleton />
          </>
        ) : (
          profiles.map((profile, index) => (
            <button
              aria-label={`${profile.name} profile`}
              className="profile-card focusable"
              data-focusable="true"
              data-autofocus={index === 0 && !error ? 'true' : undefined}
              key={profile.id}
              onClick={() => onChoose(profile)}
            >
              <Avatar avatarId={profile.avatarId} name={profile.name} index={index} />
              <span className="profile-card-name">{profile.name}</span>
              <span className="profile-card-detail">Personal profile</span>
            </button>
          ))
        )}

        {!loading ? (
          <>
            <button
              aria-label="Guest profile"
              className="profile-card focusable"
              data-focusable="true"
              data-autofocus={profiles.length === 0 && !error ? 'true' : undefined}
              onClick={onChooseGuest}
            >
              <Avatar avatarId="guest" name="Guest" index={profiles.length} />
              <span className="profile-card-name">Guest</span>
              <span className="profile-card-detail">Erased when you leave</span>
            </button>

            <button
              aria-label="Add profile"
              className="profile-card add-profile focusable"
              data-focusable="true"
              onClick={onCreate}
            >
              <span className="add-avatar" aria-hidden="true">
                +
              </span>
              <span className="profile-card-name">Add profile</span>
              <span className="profile-card-detail">Create a private space</span>
            </button>
          </>
        ) : null}
      </div>
    </section>
  );
}

function Home({
  name,
  onOpenSettings,
  onOpenUpdates,
  onOpenYouTube,
}: {
  name: string;
  onOpenSettings: () => void;
  onOpenUpdates: () => void;
  onOpenYouTube: () => void;
}) {
  return (
    <section className="home-view" aria-labelledby="home-heading">
      <div className="section-heading">
        <p className="eyebrow">Welcome, {name}</p>
        <h1 id="home-heading">What do you want to watch?</h1>
      </div>

      <div className="app-grid">
        <button
          aria-label="YouTube. Open preview"
          className="app-card youtube-card focusable"
          data-focusable="true"
          data-autofocus="true"
          onClick={onOpenYouTube}
        >
          <span className="app-card-status">Stage 5</span>
          <span className="youtube-wordmark" aria-hidden="true">
            <span className="youtube-play">
              <i />
            </span>
            YouTube
          </span>
          <span className="app-card-copy">
            Your subscriptions, playlists, and recommendations in Firefox.
          </span>
          <span className="app-card-action">
            Open preview <b>→</b>
          </span>
        </button>

        <button
          aria-label="Settings"
          className="app-card utility-card settings-card focusable"
          data-focusable="true"
          onClick={onOpenSettings}
        >
          <span className="utility-icon" aria-hidden="true">
            ⌁
          </span>
          <span className="utility-title">Settings</span>
          <span className="app-card-copy">Controller, browser, and system status.</span>
          <span className="app-card-action">
            View settings <b>→</b>
          </span>
        </button>

        <button
          aria-label="Updates"
          className="app-card utility-card updates-card focusable"
          data-focusable="true"
          onClick={onOpenUpdates}
        >
          <span className="utility-icon update-arrow" aria-hidden="true">
            ↑
          </span>
          <span className="utility-title">Updates</span>
          <span className="app-card-copy">Version details and update readiness.</span>
          <span className="app-card-action">
            View updates <b>→</b>
          </span>
        </button>
      </div>
    </section>
  );
}

function Settings({
  controllerConnected,
  onBack,
  workerHealth,
}: {
  controllerConnected: boolean;
  onBack: () => void;
  workerHealth: BrowserWorkerHealthResponse | null;
}) {
  return (
    <DetailView
      eyebrow="MediaDeck"
      title="Settings"
      description="A clear view of the inputs and services behind your deck."
      onBack={onBack}
    >
      <div className="detail-grid">
        <StatusCard
          label="Controller"
          value={controllerConnected ? 'Connected' : 'Ready to connect'}
          detail={
            controllerConnected
              ? 'D-pad, A, and B are active.'
              : 'Press any button on a connected controller.'
          }
          tone={controllerConnected ? 'good' : 'neutral'}
        />
        <StatusCard
          label="Firefox worker"
          value={
            workerHealth?.status === 'online'
              ? 'Online'
              : workerHealth?.status === 'offline'
                ? 'Offline'
                : 'Not configured'
          }
          detail={
            workerHealth
              ? `${capitalize(workerHealth.transport.provider)} · ${workerHealth.transport.mode}`
              : 'Worker status is currently unavailable.'
          }
          tone={workerHealth?.status === 'online' ? 'good' : 'neutral'}
        />
        <StatusCard
          label="Input support"
          value="Controller first"
          detail="Keyboard, mouse, and touch remain fully supported."
          tone="good"
        />
        <StatusCard
          label="Administration"
          value="Coming in Stage 6"
          detail="Protected settings and diagnostics will live here."
          tone="neutral"
        />
      </div>
    </DetailView>
  );
}

function Updates({ onBack, version }: { onBack: () => void; version: string }) {
  return (
    <DetailView
      eyebrow="System"
      title="Updates"
      description="MediaDeck will check automatically and wait for your approval."
      onBack={onBack}
    >
      <div className="update-panel">
        <div className="update-orbit" aria-hidden="true">
          <span>↑</span>
        </div>
        <div>
          <span className="update-label">Installed version</span>
          <strong>MediaDeck {version}</strong>
          <p>
            Automatic checks and the approved update workflow arrive in Stage 6. Nothing
            installs without administrator approval.
          </p>
        </div>
        <span className="stage-badge">Foundation current</span>
      </div>
    </DetailView>
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
    <section className="detail-view" aria-labelledby="detail-heading">
      <button
        className="back-button focusable"
        data-focusable="true"
        data-autofocus="true"
        onClick={onBack}
      >
        <span aria-hidden="true">←</span> Back
      </button>
      <div className="section-heading">
        <p className="eyebrow">{eyebrow}</p>
        <h1 id="detail-heading">{title}</h1>
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
  tone: 'good' | 'neutral';
  value: string;
}) {
  return (
    <article className="status-card">
      <span className={`status-card-light ${tone}`} aria-hidden="true" />
      <span className="status-card-label">{label}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

function CreateProfileDialog({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (profile: Profile) => void;
}) {
  const [name, setName] = useState('');
  const [avatarId, setAvatarId] = useState(avatarOptions[0] ?? 'ember');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Enter a profile name.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const profile = await requestJson<Profile>('/api/v1/profiles', {
        body: JSON.stringify({ avatarId, name: trimmedName }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      onCreated(profile);
    } catch (requestError) {
      setError(getErrorMessage(requestError, 'The profile could not be created.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal label="Create profile" onClose={onCancel}>
      <p className="eyebrow">New space</p>
      <h2>Create a profile</h2>
      <p className="modal-copy">
        This profile gets its own private Firefox data and preferences.
      </p>

      <form onSubmit={(event) => void handleSubmit(event)}>
        <label className="field-label" htmlFor="profile-name">
          Profile name
        </label>
        <input
          id="profile-name"
          className="text-field focusable"
          data-focusable="true"
          data-autofocus="true"
          maxLength={48}
          onChange={(event) => setName(event.target.value)}
          placeholder="Name"
          value={name}
        />

        <fieldset className="avatar-fieldset">
          <legend>Choose a color</legend>
          <div className="avatar-options">
            {avatarOptions.map((option, index) => (
              <button
                aria-label={`Use ${option} avatar`}
                aria-pressed={avatarId === option}
                className="avatar-option focusable"
                data-focusable="true"
                key={option}
                onClick={() => setAvatarId(option)}
                type="button"
              >
                <Avatar avatarId={option} name={name || 'New'} index={index} small />
              </button>
            ))}
          </div>
        </fieldset>

        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="modal-actions">
          <button
            className="secondary-button focusable"
            data-focusable="true"
            disabled={saving}
            onClick={onCancel}
            type="button"
          >
            Cancel
          </button>
          <button
            className="primary-button focusable"
            data-focusable="true"
            disabled={saving}
            type="submit"
          >
            {saving ? 'Creating…' : 'Create profile'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Modal({
  children,
  className = '',
  label,
  onClose,
}: {
  children: ReactNode;
  className?: string;
  label: string;
  onClose: () => void;
}) {
  function trapFocus(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Tab') return;

    const controls = [
      ...event.currentTarget.querySelectorAll<HTMLElement>(
        '[data-focusable="true"]:not(:disabled)',
      ),
    ];
    const first = controls[0];
    const last = controls.at(-1);
    if (!first || !last) return;

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-label={label}
        aria-modal="true"
        className={`modal-card ${className}`}
        onKeyDown={trapFocus}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <button
          aria-label={`Close ${label}`}
          className="modal-close focusable"
          data-focusable="true"
          onClick={onClose}
        >
          ×
        </button>
        {children}
      </section>
    </div>
  );
}

function Avatar({
  avatarId,
  index = 0,
  name,
  small = false,
}: {
  avatarId: string | null;
  index?: number;
  name: string;
  small?: boolean;
}) {
  const avatarKey = avatarId ?? avatarOptions[index % avatarOptions.length] ?? 'ember';
  const initials = useMemo(
    () =>
      name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase())
        .join('') || '?',
    [name],
  );

  return (
    <span
      className={`avatar avatar-${avatarKey} ${small ? 'avatar-small' : ''}`}
      aria-hidden="true"
    >
      <i />
      <b>{avatarKey === 'guest' ? 'G' : initials}</b>
    </span>
  );
}

function ProfileSkeleton() {
  return (
    <div className="profile-card profile-skeleton" aria-hidden="true">
      <span className="avatar" />
      <span />
      <span />
    </div>
  );
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
