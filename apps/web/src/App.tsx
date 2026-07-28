import type { HealthResponse } from '@mediadeck/contracts';
import { useEffect, useState } from 'react';

type ConnectionState =
  | { status: 'connecting' }
  | { status: 'online'; version: string }
  | { status: 'unavailable' };

const statusContent: Record<
  ConnectionState['status'],
  { label: string; tone: string }
> = {
  connecting: {
    label: 'Connecting',
    tone: 'bg-amber-300',
  },
  online: {
    label: 'Foundation online',
    tone: 'bg-emerald-300',
  },
  unavailable: {
    label: 'Service unavailable',
    tone: 'bg-rose-400',
  },
};

export function App() {
  const [connection, setConnection] = useState<ConnectionState>({
    status: 'connecting',
  });

  useEffect(() => {
    const controller = new AbortController();

    void fetch('/api/v1/health', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Health request failed with ${response.status}`);
        }

        return (await response.json()) as HealthResponse;
      })
      .then((health) => {
        setConnection({ status: 'online', version: health.version });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }

        setConnection({ status: 'unavailable' });
      });

    return () => controller.abort();
  }, []);

  const currentStatus = statusContent[connection.status];

  return (
    <main className="relative isolate min-h-dvh overflow-hidden bg-[#07080b] px-6 py-8 text-white sm:px-10 lg:px-16">
      <div
        className="pointer-events-none absolute inset-0 -z-20 bg-[radial-gradient(circle_at_78%_18%,rgba(250,44,90,0.14),transparent_32%),radial-gradient(circle_at_14%_88%,rgba(87,72,255,0.12),transparent_28%)]"
        aria-hidden="true"
      />
      <div
        className="grid-texture pointer-events-none absolute inset-0 -z-10 opacity-30"
        aria-hidden="true"
      />

      <div className="mx-auto flex min-h-[calc(100dvh-4rem)] max-w-7xl flex-col">
        <header className="flex items-center justify-between">
          <a
            href="/"
            className="focus-ring inline-flex items-center gap-3 rounded-xl"
            aria-label="MediaDeck home"
          >
            <span
              className="grid size-10 place-items-center rounded-xl bg-white text-[#07080b] shadow-[0_0_32px_rgba(255,255,255,0.12)]"
              aria-hidden="true"
            >
              <svg viewBox="0 0 24 24" className="size-5" fill="currentColor">
                <path d="M8 5.25v13.5L19 12 8 5.25Z" />
              </svg>
            </span>
            <span className="text-lg font-semibold tracking-[-0.02em]">MediaDeck</span>
          </a>

          <div className="flex items-center gap-2.5 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-2 text-xs font-medium text-white/70 backdrop-blur">
            <span
              className={`size-2 rounded-full ${currentStatus.tone}`}
              aria-hidden="true"
            />
            <span>{currentStatus.label}</span>
          </div>
        </header>

        <section className="flex flex-1 items-center py-16 lg:py-24">
          <div className="grid w-full items-end gap-14 lg:grid-cols-[1fr_23rem] lg:gap-20">
            <div className="max-w-4xl">
              <p className="mb-6 text-sm font-semibold tracking-[0.18em] text-white/45 uppercase">
                Stage one · Repository foundation
              </p>
              <h1 className="text-balance text-[clamp(3.5rem,10vw,8.75rem)] leading-[0.82] font-semibold tracking-[-0.075em]">
                Your media.
                <span className="block text-white/28">One simple deck.</span>
              </h1>
              <p className="mt-8 max-w-2xl text-pretty text-lg leading-8 text-white/55 sm:text-xl">
                A private, controller-first home for Firefox-powered streaming. The
                foundation is ready for profiles, sessions, and YouTube.
              </p>
            </div>

            <aside className="rounded-[1.75rem] border border-white/10 bg-white/[0.045] p-6 shadow-2xl shadow-black/20 backdrop-blur-xl">
              <div className="mb-10 flex items-center justify-between">
                <span className="text-sm font-medium text-white/50">System</span>
                <span className="font-mono text-xs text-white/35">
                  {connection.status === 'online' ? `v${connection.version}` : 'v0.1.0'}
                </span>
              </div>

              <dl className="space-y-4">
                <StatusRow label="Web interface" value="Ready" />
                <StatusRow label="API" value={currentStatus.label} />
                <StatusRow
                  label="Persistent storage"
                  value={
                    connection.status === 'online'
                      ? 'Mounted'
                      : connection.status === 'connecting'
                        ? 'Checking'
                        : 'Unknown'
                  }
                />
              </dl>

              <div className="mt-8 border-t border-white/8 pt-5 text-sm leading-6 text-white/35">
                Firefox streaming arrives in the next implementation stage.
              </div>
            </aside>
          </div>
        </section>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-white/8 pt-5 text-xs text-white/30">
          <span>Private by design</span>
          <span>Controller · Touch · Desktop</span>
        </footer>
      </div>
    </main>
  );
}

type StatusRowProperties = {
  label: string;
  value: string;
};

function StatusRow({ label, value }: StatusRowProperties) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <dt className="text-white/45">{label}</dt>
      <dd className="font-medium text-white/80">{value}</dd>
    </div>
  );
}
