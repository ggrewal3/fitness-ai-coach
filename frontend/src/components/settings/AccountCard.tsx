import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/useAuth'
import type { Account } from '../../services/account'
import { CalendarIcon, InfoIcon, MailIcon, ShieldIcon, SignOutIcon } from '../ui/icons'
import SettingsCard from './SettingsCard'

type AccountCardProps = {
  account: Account
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long', year: 'numeric' }).format(
    new Date(value),
  )
}

function AccountCard({ account }: AccountCardProps) {
  const { logout } = useAuth()
  const navigate = useNavigate()

  function signOut() {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <SettingsCard
      icon={<ShieldIcon />}
      title="Account"
      titleId="settings-account-title"
      description="Sign-in details for FitAI Coach."
    >
      <dl className="settings-detail-list">
        <div className="settings-detail">
          <dt>
            <MailIcon size={16} />
            Sign-in email
          </dt>
          <dd>{account.email}</dd>
        </div>
        <div className="settings-detail">
          <dt>
            <CalendarIcon size={16} />
            Member since
          </dt>
          <dd>{formatDate(account.createdAt)}</dd>
        </div>
      </dl>

      <p className="settings-note">
        <InfoIcon size={16} />
        <span>Changing your password and deleting your account aren’t available yet.</span>
      </p>

      <div className="settings-account-actions">
        <button type="button" className="dashboard-secondary-button settings-signout" onClick={signOut}>
          <SignOutIcon size={18} />
          Sign out
        </button>
      </div>
    </SettingsCard>
  )
}

export default AccountCard
