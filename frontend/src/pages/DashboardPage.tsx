import { useEffect, useState } from 'react'
import {
  getBackendHealth,
  type HealthResponse,
} from '../services/api'

type ConnectionState = 'loading' | 'connected' | 'error'

function DashboardPage() {
  const [connectionState, setConnectionState] =
    useState<ConnectionState>('loading')

  const [healthData, setHealthData] =
    useState<HealthResponse | null>(null)

  useEffect(() => {
    async function checkBackend() {
      try {
        const data = await getBackendHealth()

        setHealthData(data)
        setConnectionState('connected')
      } catch (error) {
        console.error('Backend connection failed:', error)
        setConnectionState('error')
      }
    }

    void checkBackend()
  }, [])

  return (
    <section>
      <h1>Dashboard</h1>

      {connectionState === 'loading' && (
        <p>Checking backend connection...</p>
      )}

      {connectionState === 'connected' && (
        <div>
          <h2>Backend connected</h2>
          <p>{healthData?.message}</p>
        </div>
      )}

      {connectionState === 'error' && (
        <div>
          <h2>Backend unavailable</h2>
          <p>Make sure the Express server is running on port 5001.</p>
        </div>
      )}
    </section>
  )
}

export default DashboardPage