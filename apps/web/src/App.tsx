import type {
  BrowserSession,
  BrowserWorkerHealthResponse,
  HealthResponse,
  Profile,
  ProfileListResponse,
  SessionCapacity,
} from '@mediadeck/contracts';
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { ApiError, requestJson } from './api';
import { closeTopDialog } from './dialog-stack';
import { Modal } from './Modal';
import { useAutoFocus, useInputNavigation } from './navigation';
import { SettingsView, UpdatesView } from './OperationsViews';

type View = 'profiles' | 'home' | 'settings' | 'updates' | 'youtube';

type ActiveProfile = { kind: 'profile'; profile: Profile } | { kind: 'guest' };

type ConnectionState =
  | { status: 'connecting' }
  | { status: 'online'; version: string }
  | { status: 'unavailable' };

type Overlay = 'create-profile' | null;

type YouTubeResumeContext =
  | { accessToken: string; kind: 'guest'; sessionId: string }
  | {
      accessToken: string;
      kind: 'profile';
      profileId: string;
      sessionId: string;
    };

const youtubeResumeStorageKey = 'mediadeck.youtube-session';

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
  const [youtubeSessionId, setYoutubeSessionId] = useState<string | null>(null);
  const [youtubeAccessToken, setYoutubeAccessToken] = useState<string | null>(null);
  const [capacity, setCapacity] = useState<SessionCapacity | null>(null);
  const resumeAttempted = useRef(false);
  const youtubeBackHandler = useRef<(() => void) | null>(null);

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

      if (!resumeAttempted.current) {
        resumeAttempted.current = true;
        const resume = readYouTubeResumeContext();
        if (resume?.kind === 'guest') {
          setActiveProfile({ kind: 'guest' });
          setYoutubeAccessToken(resume.accessToken);
          setYoutubeSessionId(resume.sessionId);
          setView('youtube');
        } else if (resume?.kind === 'profile') {
          const profile = response.profiles.find(
            (candidate) => candidate.id === resume.profileId,
          );
          if (profile) {
            setActiveProfile({ kind: 'profile', profile });
            setYoutubeAccessToken(resume.accessToken);
            setYoutubeSessionId(resume.sessionId);
            setView('youtube');
          } else {
            clearYouTubeResumeContext();
          }
        }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setProfilesError(getErrorMessage(error, 'Profiles could not be loaded.'));
    } finally {
      if (!signal?.aborted) setProfilesLoading(false);
    }
  }, []);

  const loadCapacity = useCallback(async (signal?: AbortSignal) => {
    try {
      const next = await requestJson<SessionCapacity>(
        '/api/v1/capacity',
        signal ? { signal } : undefined,
      );
      setCapacity(next);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        setCapacity(null);
      }
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
    queueMicrotask(() => void loadCapacity(controller.signal));
    const capacityTimer = window.setInterval(() => void loadCapacity(), 10_000);
    return () => {
      controller.abort();
      window.clearInterval(capacityTimer);
    };
  }, [loadCapacity, loadProfiles]);

  const navigate = useCallback((nextView: View) => {
    setOverlay(null);
    setView(nextView);
    window.history.replaceState({ mediadeckView: nextView }, '');
  }, []);

  const goBack = useCallback(() => {
    // Back always dismisses the topmost dialog before it changes view.
    if (closeTopDialog()) return;
    if (overlay) {
      setOverlay(null);
      return;
    }
    if (view === 'youtube') {
      youtubeBackHandler.current?.();
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
      clearYouTubeResumeContext();
      setYoutubeSessionId(null);
      setYoutubeAccessToken(null);
      setActiveProfile({ kind: 'profile', profile });
      navigate('home');
    },
    [navigate],
  );

  const chooseGuest = useCallback(() => {
    clearYouTubeResumeContext();
    setYoutubeSessionId(null);
    setYoutubeAccessToken(null);
    setActiveProfile({ kind: 'guest' });
    navigate('home');
  }, [navigate]);

  const profileName =
    activeProfile?.kind === 'profile' ? activeProfile.profile.name : 'Guest';
  const currentStatus = statusContent[connection.status];

  const openYouTube = useCallback(() => {
    if (!activeProfile) return;
    const sessionId = crypto.randomUUID();
    const accessToken = createSessionAccessToken();
    writeYouTubeResumeContext(
      activeProfile.kind === 'profile'
        ? {
            kind: 'profile',
            accessToken,
            profileId: activeProfile.profile.id,
            sessionId,
          }
        : { accessToken, kind: 'guest', sessionId },
    );
    setYoutubeAccessToken(accessToken);
    setYoutubeSessionId(sessionId);
    navigate('youtube');
  }, [activeProfile, navigate]);

  const leaveYouTube = useCallback(() => {
    clearYouTubeResumeContext();
    setYoutubeSessionId(null);
    setYoutubeAccessToken(null);
    youtubeBackHandler.current = null;
    navigate('home');
  }, [navigate]);

  return (
    <main className={`app-shell view-${view}`}>
      <div className="ambient ambient-one" aria-hidden="true" />
      <div className="ambient ambient-two" aria-hidden="true" />

      {view !== 'youtube' ? (
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
                aria-label={
                  activeProfile.kind === 'guest'
                    ? 'Switch profile. Current profile: Guest, a temporary session'
                    : `Switch profile. Current profile: ${profileName}`
                }
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
                {activeProfile.kind === 'guest' ? (
                  <span className="guest-tag" aria-hidden="true">
                    Temporary
                  </span>
                ) : null}
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
      ) : null}

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
            capacity={capacity}
            isGuest={activeProfile.kind === 'guest'}
            name={profileName}
            onOpenSettings={() => navigate('settings')}
            onOpenUpdates={() => navigate('updates')}
            onOpenYouTube={openYouTube}
          />
        ) : null}

        {view === 'youtube' &&
        activeProfile &&
        youtubeSessionId &&
        youtubeAccessToken ? (
          <YouTubeView
            accessToken={youtubeAccessToken}
            activeProfile={activeProfile}
            initialSessionId={youtubeSessionId}
            onExit={leaveYouTube}
            registerBackHandler={(handler) => {
              youtubeBackHandler.current = handler;
            }}
          />
        ) : null}

        {view === 'settings' && activeProfile ? (
          <Settings
            activeProfile={activeProfile}
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

      {view !== 'youtube' ? (
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
      ) : null}

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
    </main>
  );
}

type YouTubeViewProperties = {
  accessToken: string;
  activeProfile: ActiveProfile;
  initialSessionId: string;
  onExit: () => void;
  registerBackHandler: (handler: () => void) => void;
};

function YouTubeView({
  accessToken,
  activeProfile,
  initialSessionId,
  onExit,
  registerBackHandler,
}: YouTubeViewProperties) {
  const [session, setSession] = useState<BrowserSession | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [frameLoaded, setFrameLoaded] = useState(false);
  const [entered, setEntered] = useState(false);
  const [videoActive, setVideoActive] = useState(false);
  const [audioActive, setAudioActive] = useState(false);
  const [frameKey, setFrameKey] = useState(0);
  const [recovering, setRecovering] = useState(false);
  const [exitRequested, setExitRequested] = useState(false);
  const [exitError, setExitError] = useState<string | null>(null);
  const [fullscreenError, setFullscreenError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const launchInFlight = useRef(false);

  const launch = useCallback(async () => {
    if (launchInFlight.current) return;
    launchInFlight.current = true;
    setLaunchError(null);
    setConnectionError(null);

    try {
      const nextSession = await requestJson<BrowserSession>(
        '/api/v1/applications/youtube/launch',
        {
          body: JSON.stringify(
            activeProfile.kind === 'profile'
              ? {
                  kind: 'profile',
                  accessToken,
                  profileId: activeProfile.profile.id,
                  sessionId: initialSessionId,
                }
              : { accessToken, kind: 'guest', sessionId: initialSessionId },
          ),
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
        },
      );
      setSession(nextSession);
      writeYouTubeResumeContext(
        nextSession.kind === 'profile' && nextSession.profileId
          ? {
              kind: 'profile',
              accessToken,
              profileId: nextSession.profileId,
              sessionId: nextSession.id,
            }
          : { accessToken, kind: 'guest', sessionId: nextSession.id },
      );
    } catch (error) {
      setLaunchError(getErrorMessage(error, 'YouTube could not be started.'));
    } finally {
      launchInFlight.current = false;
    }
  }, [accessToken, activeProfile, initialSessionId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void launch(), 0);
    return () => window.clearTimeout(timer);
  }, [launch]);

  useEffect(() => {
    if (!session || session.status === 'stopped' || exitRequested) return;

    const delay = session.status === 'running' ? 10_000 : 1_500;
    const timer = window.setTimeout(() => {
      void requestJson<BrowserSession>(`/api/v1/sessions/${session.id}/heartbeat`, {
        headers: sessionAccessHeaders(accessToken),
        method: 'POST',
      })
        .then((nextSession) => {
          setSession(nextSession);
          setConnectionError(null);
        })
        .catch((error: unknown) => {
          setConnectionError(
            getErrorMessage(error, 'The Firefox session stopped responding.'),
          );
        });
    }, delay);

    return () => window.clearTimeout(timer);
  }, [accessToken, connectionError, exitRequested, session]);

  const stopAndExit = useCallback(async () => {
    if (!session) return;
    setExitError(null);
    try {
      await requestJson<BrowserSession>(`/api/v1/sessions/${session.id}/stop`, {
        headers: sessionAccessHeaders(accessToken),
        method: 'POST',
      });
      onExit();
    } catch (error) {
      setExitRequested(false);
      setExitError(
        getErrorMessage(error, 'Firefox could not be stopped. Please try again.'),
      );
    }
  }, [accessToken, onExit, session]);

  const requestExit = useCallback(() => {
    setExitRequested(true);
  }, []);

  useEffect(() => {
    registerBackHandler(requestExit);
  }, [registerBackHandler, requestExit]);

  useEffect(() => {
    if (!exitRequested) return;
    const timer = window.setTimeout(() => {
      if (session) {
        void stopAndExit();
      } else if (launchError) {
        onExit();
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [exitRequested, launchError, onExit, session, stopAndExit]);

  const applyPipelineStatus = useCallback((message: unknown) => {
    if (
      !message ||
      typeof message !== 'object' ||
      !('type' in message) ||
      message.type !== 'pipelineStatusUpdate'
    ) {
      return;
    }

    if ('video' in message && typeof message.video === 'boolean') {
      setVideoActive(message.video);
    }
    if ('audio' in message && typeof message.audio === 'boolean') {
      setAudioActive(message.audio);
    }
  }, []);

  useEffect(() => {
    const handleStreamMessage = (event: MessageEvent<unknown>) =>
      applyPipelineStatus(event.data);

    window.addEventListener('message', handleStreamMessage);
    return () => window.removeEventListener('message', handleStreamMessage);
  }, [applyPipelineStatus]);

  const handleFrameLoad = useCallback(() => {
    const frameDocument = iframeRef.current?.contentDocument;
    const isSelkiesClient = Boolean(frameDocument?.querySelector('#app'));
    setFrameLoaded(isSelkiesClient);
    if (!isSelkiesClient) {
      setConnectionError('The Firefox viewer did not load correctly.');
    }

    const frameWindow = iframeRef.current?.contentWindow;
    frameWindow?.addEventListener('message', (event) => {
      applyPipelineStatus(event.data);
    });
    frameWindow?.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') requestExit();
    });
  }, [applyPipelineStatus, requestExit]);

  const enterStream = useCallback(() => {
    setEntered(true);
    const frameDocument = iframeRef.current?.contentDocument;
    frameDocument?.querySelector<HTMLButtonElement>('#playButton')?.click();
    (
      frameDocument?.querySelector<HTMLElement>('#overlayInput') ??
      frameDocument?.querySelector<HTMLElement>('#videoCanvas')
    )?.focus();
  }, []);

  const reloadStream = useCallback(() => {
    setFrameLoaded(false);
    setVideoActive(false);
    setAudioActive(false);
    setConnectionError(null);
    setFrameKey((current) => current + 1);
  }, []);

  const recover = useCallback(async () => {
    if (!session || recovering) return;
    setRecovering(true);
    setConnectionError(null);
    try {
      const recovered = await requestJson<BrowserSession>(
        `/api/v1/sessions/${session.id}/recover`,
        { headers: sessionAccessHeaders(accessToken), method: 'POST' },
      );
      setSession(recovered);
      reloadStream();
    } catch (error) {
      setConnectionError(
        getErrorMessage(error, 'The Firefox session could not be recovered.'),
      );
    } finally {
      setRecovering(false);
    }
  }, [accessToken, recovering, reloadStream, session]);

  const enterFullscreen = useCallback(async () => {
    const stage = stageRef.current;
    if (!stage?.requestFullscreen) {
      setFullscreenError('Fullscreen is not available in this browser.');
      return;
    }

    try {
      await stage.requestFullscreen();
      setFullscreenError(null);
    } catch {
      setFullscreenError(
        'Fullscreen was blocked. You can still use the browser’s own fullscreen control.',
      );
    }
  }, []);

  const profileName =
    activeProfile.kind === 'profile' ? activeProfile.profile.name : 'Guest';
  const isStarting = !session || session.status === 'starting';
  const streamStatus = connectionError
    ? 'Reconnecting'
    : videoActive
      ? audioActive
        ? 'Live · audio on'
        : 'Live'
      : session?.status === 'running'
        ? 'Connecting'
        : 'Starting Firefox';

  useAutoFocus(
    `youtube:${session?.status ?? 'launching'}:${frameLoaded}:${entered}:${Boolean(
      launchError ?? connectionError ?? exitError,
    )}`,
  );

  return (
    <section
      className="youtube-view"
      aria-label={`YouTube for ${profileName}`}
      ref={stageRef}
    >
      {session?.status === 'running' ? (
        <iframe
          allow="autoplay; fullscreen; gamepad"
          allowFullScreen
          className="stream-frame"
          key={frameKey}
          onLoad={handleFrameLoad}
          ref={iframeRef}
          src={`${session.streamUrl}?viewer=${frameKey}`}
          title={`YouTube Firefox stream for ${profileName}`}
        />
      ) : null}

      <div className="stream-toolbar">
        <button
          aria-busy={exitRequested}
          aria-label="Stop Firefox and return to MediaDeck"
          className="stream-control stream-return focusable"
          data-autofocus="true"
          data-focusable="true"
          disabled={exitRequested}
          onClick={requestExit}
        >
          <span aria-hidden="true">←</span>
          {exitRequested ? 'Closing…' : 'MediaDeck'}
        </button>

        <div className="stream-session-status" role="status" aria-live="polite">
          <span
            className={`stream-status-dot ${videoActive ? 'live' : ''}`}
            aria-hidden="true"
          />
          <span>{streamStatus}</span>
          <strong>{profileName}</strong>
        </div>

        <div className="stream-actions">
          <button
            aria-label="Reload YouTube stream"
            className="stream-control focusable"
            data-focusable="true"
            onClick={reloadStream}
          >
            Reload
          </button>
          <button
            aria-label="Enter fullscreen"
            className="stream-control focusable"
            data-focusable="true"
            onClick={() => void enterFullscreen()}
          >
            Fullscreen
          </button>
        </div>
      </div>

      {!entered || launchError || exitError || (connectionError && !videoActive) ? (
        <div className="stream-state-layer">
          <div className="stream-state-card" role={launchError ? 'alert' : 'status'}>
            <div className="modal-app-icon youtube-icon" aria-hidden="true">
              <span />
            </div>
            <p className="eyebrow">
              {activeProfile.kind === 'guest'
                ? 'Guest · temporary session'
                : `${profileName} · private session`}
            </p>
            <h1>
              {launchError
                ? 'YouTube could not start.'
                : exitError
                  ? 'Firefox is still running.'
                  : connectionError
                    ? 'The stream lost its connection.'
                    : frameLoaded
                      ? 'YouTube is ready.'
                      : 'Starting Firefox…'}
            </h1>
            <p>
              {exitError ??
                launchError ??
                connectionError ??
                (isStarting
                  ? 'Preparing your isolated Firefox profile and secure stream.'
                  : 'Connecting video, audio, and input through MediaDeck.')}
            </p>

            <div className="stream-state-actions">
              {exitError ? (
                <button
                  className="primary-button focusable"
                  data-autofocus="true"
                  data-focusable="true"
                  onClick={requestExit}
                >
                  Try closing again
                </button>
              ) : null}
              {launchError ? (
                <button
                  className="primary-button focusable"
                  data-autofocus="true"
                  data-focusable="true"
                  onClick={() => void launch()}
                >
                  Try again
                </button>
              ) : null}
              {connectionError && session ? (
                <button
                  aria-busy={recovering}
                  className="primary-button focusable"
                  data-autofocus="true"
                  data-focusable="true"
                  disabled={recovering}
                  onClick={() => void recover()}
                >
                  {recovering ? 'Recovering…' : 'Recover Firefox'}
                </button>
              ) : null}
              {!launchError && !connectionError && frameLoaded ? (
                <button
                  className="primary-button focusable"
                  data-autofocus="true"
                  data-focusable="true"
                  onClick={enterStream}
                >
                  Enter YouTube
                </button>
              ) : null}
              {!frameLoaded && !launchError && !connectionError ? (
                <span className="stream-loader" aria-hidden="true" />
              ) : null}
            </div>

            {exitError ? (
              <p className="form-error" role="alert">
                {exitError}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {entered && connectionError && videoActive ? (
        <div className="stream-toast" role="status">
          Stream connection is recovering automatically.
        </div>
      ) : null}

      {fullscreenError ? (
        <div className="stream-toast stream-toast-error" role="status">
          {fullscreenError}
        </div>
      ) : null}
    </section>
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
              aria-label="Guest profile, a temporary session that is erased when you leave"
              className="profile-card focusable"
              data-focusable="true"
              data-autofocus={profiles.length === 0 && !error ? 'true' : undefined}
              onClick={onChooseGuest}
            >
              <Avatar avatarId="guest" name="Guest" index={profiles.length} />
              <span className="profile-card-name">Guest</span>
              <span className="profile-card-detail temporary">
                Erased when you leave
              </span>
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
  capacity,
  isGuest,
  name,
  onOpenSettings,
  onOpenUpdates,
  onOpenYouTube,
}: {
  capacity: SessionCapacity | null;
  isGuest: boolean;
  name: string;
  onOpenSettings: () => void;
  onOpenUpdates: () => void;
  onOpenYouTube: () => void;
}) {
  const atCapacity = capacity?.atCapacity ?? false;

  return (
    <section className="home-view" aria-labelledby="home-heading">
      <div className="section-heading">
        <p className="eyebrow">Welcome, {name}</p>
        <h1 id="home-heading">What do you want to watch?</h1>
        {isGuest ? (
          <p>
            Guest is a temporary session. Its Firefox history, logins, and downloads are
            deleted the moment you return to MediaDeck.
          </p>
        ) : null}
      </div>

      <div className="app-grid">
        <button
          aria-describedby={atCapacity ? 'youtube-capacity-note' : undefined}
          aria-label="Launch YouTube"
          className="app-card youtube-card focusable"
          data-focusable="true"
          data-autofocus="true"
          disabled={atCapacity}
          onClick={onOpenYouTube}
        >
          <span className={`app-card-status ${atCapacity ? 'busy' : ''}`}>
            {capacity?.atCapacity
              ? 'All streams busy'
              : capacity
                ? `${capacity.availableSlots} stream${capacity.availableSlots === 1 ? '' : 's'} free`
                : 'Ready'}
          </span>
          <span className="youtube-wordmark" aria-hidden="true">
            <span className="youtube-play">
              <i />
            </span>
            YouTube
          </span>
          <span
            className="app-card-copy"
            id={atCapacity ? 'youtube-capacity-note' : undefined}
          >
            {capacity?.atCapacity
              ? `The host is running ${capacity.activeSessions} of ${capacity.maxSessions} streams. Try again when one closes.`
              : 'Your subscriptions, playlists, and recommendations in Firefox.'}
          </span>
          <span className="app-card-action">
            {atCapacity ? 'Waiting for a free stream' : 'Start watching'} <b>→</b>
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
  activeProfile,
  controllerConnected,
  onBack,
  workerHealth,
}: {
  activeProfile: ActiveProfile;
  controllerConnected: boolean;
  onBack: () => void;
  workerHealth: BrowserWorkerHealthResponse | null;
}) {
  return (
    <SettingsView
      controllerConnected={controllerConnected}
      onBack={onBack}
      profile={activeProfile.kind === 'profile' ? activeProfile.profile : null}
      workerHealth={workerHealth}
    />
  );
}

function Updates({ onBack, version }: { onBack: () => void; version: string }) {
  return <UpdatesView onBack={onBack} version={version} />;
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
          aria-describedby={error ? 'profile-name-error' : undefined}
          aria-invalid={error ? true : undefined}
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
          <p className="form-error" id="profile-name-error" role="alert">
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
            aria-busy={saving}
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

function readYouTubeResumeContext(): YouTubeResumeContext | null {
  try {
    const stored = sessionStorage.getItem(youtubeResumeStorageKey);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as Partial<YouTubeResumeContext>;
    if (
      typeof parsed.sessionId !== 'string' ||
      typeof parsed.accessToken !== 'string' ||
      (parsed.kind !== 'guest' && parsed.kind !== 'profile')
    ) {
      return null;
    }
    if (parsed.kind === 'profile') {
      return typeof parsed.profileId === 'string'
        ? {
            kind: 'profile',
            accessToken: parsed.accessToken,
            profileId: parsed.profileId,
            sessionId: parsed.sessionId,
          }
        : null;
    }
    return {
      accessToken: parsed.accessToken,
      kind: 'guest',
      sessionId: parsed.sessionId,
    };
  } catch {
    return null;
  }
}

function writeYouTubeResumeContext(context: YouTubeResumeContext): void {
  sessionStorage.setItem(youtubeResumeStorageKey, JSON.stringify(context));
}

function clearYouTubeResumeContext(): void {
  sessionStorage.removeItem(youtubeResumeStorageKey);
}

function createSessionAccessToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function sessionAccessHeaders(accessToken: string): HeadersInit {
  return { 'X-MediaDeck-Session-Token': accessToken };
}
