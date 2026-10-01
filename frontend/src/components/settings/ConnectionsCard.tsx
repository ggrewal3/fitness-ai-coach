import type { ReactNode } from 'react'
import { HeartIcon, LinkIcon, PhoneIcon, PulseIcon } from '../ui/icons'
import SettingsCard from './SettingsCard'

const CONNECTIONS: { name: string; platform: string; icon: ReactNode }[] = [
  { name: 'Apple Health', platform: 'iPhone and Apple Watch', icon: <HeartIcon /> },
  { name: 'Android Health Connect', platform: 'Android phones and wearables', icon: <PulseIcon /> },
]

// Informational only (ADR-016): no health integration exists, so there are no
// connect buttons, toggles or provider logos.
function ConnectionsCard() {
  return (
    <SettingsCard
      icon={<LinkIcon />}
      title="Connections"
      titleId="settings-connections-title"
      description="Health data from your phone and wearables."
    >
      <ul className="settings-connection-list">
        {CONNECTIONS.map((connection) => (
          <li key={connection.name} className="settings-connection">
            <span className="settings-connection-icon" aria-hidden="true">
              {connection.icon}
            </span>
            <span className="settings-connection-text">
              <span className="settings-connection-name">{connection.name}</span>
              <span className="settings-connection-platform">{connection.platform}</span>
            </span>
            <span className="settings-badge">Not connected</span>
          </li>
        ))}
      </ul>
      <p className="settings-note">
        <PhoneIcon size={16} />
        <span>Syncing requires the FitAI mobile app, which isn’t available yet.</span>
      </p>
    </SettingsCard>
  )
}

export default ConnectionsCard
