import type { Account } from '../../services/account'
import type { FitnessGoal } from '../../services/fitnessProfile'
import { goalLabel } from '../../features/settings/fitnessDraft'
import { CalendarIcon, SparkIcon } from '../ui/icons'
import ProfilePhoto from './ProfilePhoto'

type ProfileHeroProps = {
  account: Account
  goal: FitnessGoal | null
  onAccountChange: (account: Account) => void
  onRefreshAvatarUrl: () => Promise<void>
  announce: (message: string) => void
}

function formatMemberSince(createdAt: string): string {
  return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(new Date(createdAt))
}

// Identity header for Settings. Shows the saved account (not unsaved drafts).
// ProfilePhoto renders the avatar and photo actions around the identity block.
function ProfileHero({ account, goal, onAccountChange, onRefreshAvatarUrl, announce }: ProfileHeroProps) {
  const fullName = `${account.firstName} ${account.lastName}`.trim()
  const goalName = goalLabel(goal)

  return (
    <div className="settings-hero">
      <ProfilePhoto
        account={account}
        onAccountChange={onAccountChange}
        onRefreshAvatarUrl={onRefreshAvatarUrl}
        announce={announce}
      >
        <div className="settings-hero-identity">
          <p className="settings-hero-name">{fullName}</p>
          <p className="settings-hero-email">{account.email}</p>
          <div className="settings-hero-meta">
            <span className="settings-hero-meta-item">
              <CalendarIcon size={16} />
              Member since {formatMemberSince(account.createdAt)}
            </span>
            {goalName && (
              <span className="settings-goal-chip">
                <SparkIcon size={14} />
                Goal · {goalName}
              </span>
            )}
          </div>
        </div>
      </ProfilePhoto>
    </div>
  )
}

export default ProfileHero
