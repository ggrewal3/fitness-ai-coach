import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import AboutYouCard from '../components/settings/AboutYouCard'
import AccountCard from '../components/settings/AccountCard'
import AppearanceCard from '../components/settings/AppearanceCard'
import ConnectionsCard from '../components/settings/ConnectionsCard'
import FitnessCard, { FitnessErrorCard } from '../components/settings/FitnessCard'
import PersonalInfoCard from '../components/settings/PersonalInfoCard'
import ProfileHero from '../components/settings/ProfileHero'
import SettingsNav from '../components/settings/SettingsNav'
import UnitsCard from '../components/settings/UnitsCard'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import { AlertIcon } from '../components/ui/icons'
import Skeleton from '../components/ui/Skeleton'
import { useUnsavedChangesGuard } from '../features/navigation/useUnsavedChangesGuard'
import {
  SETTINGS_SECTIONS,
  isSettingsSectionId,
  sectionHeadingId,
  type SettingsSectionId,
} from '../features/settings/sections'
import { useScrollSpy } from '../features/settings/useScrollSpy'
import { fetchAccount, type Account, type UnitPreferences } from '../services/account'
import { fetchFitnessProfile, type FitnessProfile } from '../services/fitnessProfile'

type LoadState = 'loading' | 'ready' | 'error'
type DirtyKey = 'personal' | 'bio' | 'fitness'

// Must match the CSS breakpoint where the side navigation becomes chips.
const CHIP_NAV_QUERY = '(max-width: 1100px)'
const SECTION_IDS = SETTINGS_SECTIONS.map((section) => section.id)

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function SettingsSkeleton() {
  return (
    <div className="settings-content" aria-busy="true">
      <p className="sr-only" role="status">
        Loading settings…
      </p>
      <div className="settings-hero">
        <Skeleton className="settings-hero-avatar" width="" height="" radius="999px" />
        <div className="settings-hero-identity">
          <Skeleton width="60%" height="1.75rem" />
          <Skeleton width="45%" height="1rem" />
          <Skeleton width="35%" height="1rem" />
        </div>
      </div>
      {[0, 1].map((card) => (
        <div key={card} className="settings-card settings-card-skeleton">
          <div className="settings-card-header">
            <Skeleton width="36px" height="36px" radius="10px" />
            <div className="settings-card-heading">
              <Skeleton width="40%" height="1.1rem" />
              <Skeleton width="65%" height="0.9rem" />
            </div>
          </div>
          <div className="settings-field-grid">
            {[0, 1, 2, 3].map((field) => (
              <div key={field} className="settings-field">
                <Skeleton width="35%" height="0.9rem" />
                <Skeleton height="44px" radius="8px" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function SettingsPage() {
  const [account, setAccount] = useState<Account | null>(null)
  const [accountState, setAccountState] = useState<LoadState>('loading')
  const [profile, setProfile] = useState<FitnessProfile | null>(null)
  const [profileState, setProfileState] = useState<LoadState>('loading')
  const [reloadToken, setReloadToken] = useState(0)
  const [profileReloadToken, setProfileReloadToken] = useState(0)
  const [dirty, setDirty] = useState<Record<DirtyKey, boolean>>({ personal: false, bio: false, fitness: false })
  const [announcement, setAnnouncement] = useState('')
  const navRef = useRef<HTMLElement>(null)
  const didHandleInitialHash = useRef(false)

  // Account and fitness profile load in parallel; a fitness failure doesn't
  // block the rest of the page.
  useEffect(() => {
    let isCurrent = true

    async function load() {
      const [accountResult, profileResult] = await Promise.allSettled([fetchAccount(), fetchFitnessProfile()])

      if (!isCurrent) {
        return
      }

      if (accountResult.status === 'fulfilled') {
        setAccount(accountResult.value)
        setAccountState('ready')
      } else {
        setAccountState('error')
      }

      if (profileResult.status === 'fulfilled') {
        setProfile(profileResult.value)
        setProfileState('ready')
      } else {
        setProfileState('error')
      }
    }

    void load()

    return () => {
      isCurrent = false
    }
  }, [reloadToken])

  useEffect(() => {
    if (profileReloadToken === 0) {
      return
    }

    let isCurrent = true

    async function reloadProfile() {
      try {
        const loaded = await fetchFitnessProfile()

        if (isCurrent) {
          setProfile(loaded)
          setProfileState('ready')
        }
      } catch {
        if (isCurrent) {
          setProfileState('error')
        }
      }
    }

    void reloadProfile()

    return () => {
      isCurrent = false
    }
  }, [profileReloadToken])

  const announce = useCallback((message: string) => {
    // A trailing no-break space makes a repeated message count as a change.
    setAnnouncement((current) => (current === message ? `${message}\u00a0` : message))
  }, [])

  const setPersonalDirty = useCallback((value: boolean) => setDirty((d) => ({ ...d, personal: value })), [])
  const setBioDirty = useCallback((value: boolean) => setDirty((d) => ({ ...d, bio: value })), [])
  const setFitnessDirty = useCallback((value: boolean) => setDirty((d) => ({ ...d, fitness: value })), [])

  const isDirty = dirty.personal || dirty.bio || dirty.fitness
  const blocker = useUnsavedChangesGuard(isDirty)

  const dirtySections = useMemo(() => {
    const sections = new Set<SettingsSectionId>()
    if (dirty.personal || dirty.bio) sections.add('profile')
    if (dirty.fitness) sections.add('fitness')
    return sections
  }, [dirty])

  // Height of the sticky chip navigation (narrow layouts) that content must clear.
  const getStickyOffset = useCallback(() => {
    const nav = navRef.current
    return nav && window.matchMedia(CHIP_NAV_QUERY).matches ? nav.getBoundingClientRect().height + 12 : 24
  }, [])

  const isReady = accountState === 'ready' && account !== null
  const activeId = useScrollSpy(SECTION_IDS, getStickyOffset, isReady) as SettingsSectionId

  const scrollToSection = useCallback(
    (id: SettingsSectionId, behavior: ScrollBehavior) => {
      const section = document.getElementById(id)

      if (!section) {
        return
      }

      const top = section.getBoundingClientRect().top + window.scrollY - getStickyOffset()
      window.scrollTo({ top: Math.max(0, top), behavior })
      document.getElementById(sectionHeadingId(id))?.focus({ preventScroll: true })
    },
    [getStickyOffset],
  )

  function handleNavigate(id: SettingsSectionId) {
    scrollToSection(id, prefersReducedMotion() ? 'auto' : 'smooth')
    // Keep the URL shareable without a router navigation (and without
    // disturbing React Router's history state).
    window.history.replaceState(window.history.state, '', `#${id}`)
  }

  // Deep links such as /settings#units scroll once the content exists.
  useEffect(() => {
    if (!isReady || didHandleInitialHash.current) {
      return
    }

    didHandleInitialHash.current = true
    const hash = window.location.hash.slice(1)

    if (isSettingsSectionId(hash)) {
      scrollToSection(hash, 'auto')
    }
  }, [isReady, scrollToSection])

  const handleAccountSaved = useCallback((saved: Account) => setAccount(saved), [])
  const handlePreferencesSaved = useCallback(
    (preferences: UnitPreferences) => setAccount((current) => (current ? { ...current, preferences } : current)),
    [],
  )

  function sectionHeading(id: SettingsSectionId, label: string) {
    return (
      <h2 id={sectionHeadingId(id)} className="settings-section-title" tabIndex={-1}>
        {label}
      </h2>
    )
  }

  return (
    <div className="settings-page">
      <header className="settings-page-header">
        <h1 className="dashboard-title">Settings</h1>
        <p className="settings-page-intro">Your profile, preferences and connected services.</p>
      </header>

      <div className="settings-layout">
        <SettingsNav
          navRef={navRef}
          activeId={isReady ? activeId : 'profile'}
          dirtySections={dirtySections}
          onNavigate={handleNavigate}
        />

        {accountState === 'loading' && <SettingsSkeleton />}

        {accountState === 'error' && (
          <div className="settings-content">
            <div className="settings-card settings-page-error" role="alert">
              <span className="settings-icon-tile settings-icon-tile-danger" aria-hidden="true">
                <AlertIcon />
              </span>
              <div>
                <p className="settings-page-error-title">Settings couldn’t be loaded.</p>
                <p className="settings-card-description">Check your connection and try again.</p>
              </div>
              <button
                type="button"
                className="dashboard-primary-button"
                onClick={() => {
                  setAccountState('loading')
                  setProfileState('loading')
                  setReloadToken((token) => token + 1)
                }}
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {isReady && (
          <div className="settings-content">
            <section id="profile" className="settings-section" aria-labelledby={sectionHeadingId('profile')}>
              {sectionHeading('profile', 'Profile')}
              <ProfileHero account={account} goal={profile?.goal ?? null} />
              <PersonalInfoCard
                account={account}
                onSaved={handleAccountSaved}
                onDirtyChange={setPersonalDirty}
                announce={announce}
              />
              <AboutYouCard
                account={account}
                onSaved={handleAccountSaved}
                onDirtyChange={setBioDirty}
                announce={announce}
              />
            </section>

            <section id="fitness" className="settings-section" aria-labelledby={sectionHeadingId('fitness')}>
              {sectionHeading('fitness', 'Fitness')}
              {profileState === 'ready' && (
                <FitnessCard
                  profile={profile}
                  onSaved={setProfile}
                  onDirtyChange={setFitnessDirty}
                  announce={announce}
                />
              )}
              {profileState !== 'ready' && (
                <FitnessErrorCard
                  isRetrying={profileState === 'loading'}
                  onRetry={() => {
                    setProfileState('loading')
                    setProfileReloadToken((token) => token + 1)
                  }}
                />
              )}
            </section>

            <section id="units" className="settings-section" aria-labelledby={sectionHeadingId('units')}>
              {sectionHeading('units', 'Units')}
              <UnitsCard preferences={account.preferences} onSaved={handlePreferencesSaved} announce={announce} />
            </section>

            <section id="appearance" className="settings-section" aria-labelledby={sectionHeadingId('appearance')}>
              {sectionHeading('appearance', 'Appearance')}
              <AppearanceCard />
            </section>

            <section id="connections" className="settings-section" aria-labelledby={sectionHeadingId('connections')}>
              {sectionHeading('connections', 'Connections')}
              <ConnectionsCard />
            </section>

            <section id="account" className="settings-section" aria-labelledby={sectionHeadingId('account')}>
              {sectionHeading('account', 'Account')}
              <AccountCard account={account} />
            </section>
          </div>
        )}
      </div>

      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      {blocker.state === 'blocked' && (
        <ConfirmDialog
          title="Discard changes?"
          message="You have unsaved changes in Settings. If you leave now, they will be lost."
          confirmLabel="Discard changes"
          cancelLabel="Keep editing"
          onConfirm={() => blocker.proceed()}
          onCancel={() => blocker.reset()}
        />
      )}
    </div>
  )
}

export default SettingsPage
