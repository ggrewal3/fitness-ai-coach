import type { Account } from '../../services/account'
import type { FitnessGoal } from '../../services/fitnessProfile'
import { goalLabel } from '../../features/settings/fitnessDraft'
import Avatar from '../ui/Avatar'
import { CalendarIcon, SparkIcon } from '../ui/icons'

type ProfileHeroProps = {
  account: Account
  goal: FitnessGoal | null
}

function formatMemberSince(createdAt: string): string {
  return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(new Date(createdAt))
}

// Identity header for Settings. Shows the saved account (not unsaved drafts).
// Phase 3C will pass a real photo URL to Avatar and add photo actions here.
function ProfileHero({ account, goal }: ProfileHeroProps) {
  const fullName = `${account.firstName} ${account.lastName}`.trim()
  const goalName = goalLabel(goal)

  return (
    <div className="settings-hero">
      <Avatar className="settings-hero-avatar" firstName={account.firstName} lastName={account.lastName} />
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
    </div>
  )
}

export default ProfileHero
